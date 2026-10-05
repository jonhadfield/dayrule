import sodium from 'libsodium-wrappers-sumo'
// The keyring: holds the account key (AK) in memory and does everything
// that needs it (PLAN.md §10.2, §10.4). It runs inside the crypto worker,
// so the AK never enters the page's JavaScript.

import {
  ALG,
  DEFAULT_KDF,
  decryptRecord,
  deriveMasterKey,
  encryptRecord,
  fromBase64,
  hkdf,
  KEY_BYTES,
  LABELS,
  randomBytes,
  ready,
  SALT_BYTES,
  toBase64,
  toHex,
  unwrapKey,
  wipe,
  wrapKey,
  type Envelope,
  type KdfParams,
  type RecordMeta,
} from './primitives'
import {
  fromPhrase,
  newRecoveryEntropy,
  recoveryKey,
  toPhrase,
} from './recovery'

/** A wrapped key as sent to and stored by the server (base64). */
export interface WrappedB64 {
  nonce: string
  ciphertext: string
}

export interface EnvelopeB64 {
  alg: typeof ALG
  keyId: number
  nonce: string
  ciphertext: string
}

/** What sign-up and password changes send to the server. */
export interface Credentials {
  salt: string
  kdf: KdfParams
  /** HKDF(MasterKey, auth label): proves the password; can't decrypt anything. */
  authKey: string
  wrappedPassword: WrappedB64
}

/** Stores the device key for "stay unlocked on this device" (§10.4). */
export interface DeviceStore {
  get(
    userId: string,
  ): Promise<{ key: CryptoKey; iv: Uint8Array; blob: Uint8Array } | undefined>
  put(
    userId: string,
    value: { key: CryptoKey; iv: Uint8Array; blob: Uint8Array },
  ): Promise<void>
  delete(userId: string): Promise<void>
}

const b64 = (s: { nonce: Uint8Array; ciphertext: Uint8Array }): WrappedB64 => ({
  nonce: toBase64(s.nonce),
  ciphertext: toBase64(s.ciphertext),
})
const unb64 = (w: WrappedB64) => ({
  nonce: fromBase64(w.nonce),
  ciphertext: fromBase64(w.ciphertext),
})

export class Keyring {
  private ak: Uint8Array | null = null
  private userId: string | null = null
  /** KEK between deriving it for login and the server returning the wrap. */
  private pendingKek: Uint8Array | null = null
  private syncIdKey: Uint8Array | null = null
  private readonly device: DeviceStore

  constructor(device: DeviceStore) {
    this.device = device
  }

  isUnlocked(): boolean {
    return this.ak !== null
  }

  /** Forget the account key (lock, sign out, auto-lock). */
  lock(): void {
    wipe(this.ak, this.pendingKek, this.syncIdKey)
    this.ak = null
    this.pendingKek = null
    this.syncIdKey = null
  }

  private async credentialsFor(
    password: string,
    userId: string,
    ak: Uint8Array,
    kdf: KdfParams,
  ) {
    const salt = randomBytes(SALT_BYTES)
    const mk = deriveMasterKey(password, salt, kdf)
    const authKey = await hkdf(mk, LABELS.auth)
    const kek = await hkdf(mk, LABELS.kek)
    const wrapped = wrapKey(kek, ak, LABELS.wrapUnderKek, userId)
    const creds: Credentials = {
      salt: toBase64(salt),
      kdf,
      authKey: toBase64(authKey),
      wrappedPassword: b64(wrapped),
    }
    wipe(mk, kek, authKey)
    return creds
  }

  /**
   * Sign-up: a new random account key and recovery phrase. The keyring is
   * unlocked afterwards. The phrase is returned once, to show the user.
   */
  async createAccount(
    password: string,
    userId: string,
    kdf: KdfParams = DEFAULT_KDF,
  ) {
    await ready()
    const ak = randomBytes(KEY_BYTES)
    const creds = await this.credentialsFor(password, userId, ak, kdf)
    const entropy = newRecoveryEntropy()
    const rk = await recoveryKey(entropy)
    const wrappedRecovery = b64(wrapKey(rk, ak, LABELS.wrapRecovery, userId))
    const recoveryWords = toPhrase(entropy)
    const recoveryProof = await this.proofFrom(entropy)
    wipe(rk, entropy)
    this.lock()
    this.ak = ak
    this.userId = userId
    return { ...creds, wrappedRecovery, recoveryWords, recoveryProof }
  }

  /** Login step 1: derive the AuthKey to send; keep the KEK for step 2. */
  async beginLogin(
    password: string,
    salt: string,
    kdf: KdfParams,
  ): Promise<string> {
    await ready()
    const mk = deriveMasterKey(password, fromBase64(salt), kdf)
    const authKey = await hkdf(mk, LABELS.auth)
    wipe(this.pendingKek)
    this.pendingKek = await hkdf(mk, LABELS.kek)
    wipe(mk)
    const out = toBase64(authKey)
    wipe(authKey)
    return out
  }

  /** Login step 2: unwrap the account key the server returned. */
  async finishLogin(userId: string, wrapped: WrappedB64): Promise<void> {
    await ready()
    if (!this.pendingKek) throw new Error('login not started')
    try {
      const ak = unwrapKey(
        this.pendingKek,
        unb64(wrapped),
        LABELS.wrapUnderKek,
        userId,
      )
      this.lock()
      this.ak = ak
      this.userId = userId
    } finally {
      wipe(this.pendingKek)
      this.pendingKek = null
    }
  }

  /** Forgot password: the recovery phrase unwraps the AK; set a new password. */
  async recover(
    words: string,
    userId: string,
    wrappedRecovery: WrappedB64,
    newPassword: string,
    kdf: KdfParams = DEFAULT_KDF,
  ) {
    await ready()
    const entropy = fromPhrase(words)
    const rk = await recoveryKey(entropy)
    try {
      const ak = unwrapKey(
        rk,
        unb64(wrappedRecovery),
        LABELS.wrapRecovery,
        userId,
      )
      const creds = await this.credentialsFor(newPassword, userId, ak, kdf)
      this.lock()
      this.ak = ak
      this.userId = userId
      return creds
    } finally {
      wipe(rk, entropy)
    }
  }

  /**
   * Proof of holding the recovery phrase, for the server. It's a separate
   * HKDF output, so it can't unwrap the account key; the server stores only
   * its SHA-256.
   */
  async recoveryProof(words: string): Promise<string> {
    await ready()
    const entropy = fromPhrase(words)
    try {
      return await this.proofFrom(entropy)
    } finally {
      wipe(entropy)
    }
  }

  private async proofFrom(entropy: Uint8Array): Promise<string> {
    const proof = await hkdf(entropy, 'dayrule/recovery-proof/v1')
    const out = toBase64(proof)
    wipe(proof)
    return out
  }

  /** New password while unlocked: rewrap the AK, nothing is re-encrypted. */
  async changePassword(
    newPassword: string,
    kdf: KdfParams = DEFAULT_KDF,
  ): Promise<Credentials> {
    await ready()
    const { ak, userId } = this.requireUnlocked()
    return this.credentialsFor(newPassword, userId, ak, kdf)
  }

  private requireUnlocked(): { ak: Uint8Array; userId: string } {
    if (!this.ak || !this.userId) throw new Error('locked')
    return { ak: this.ak, userId: this.userId }
  }

  async encrypt(
    items: { recordId: string; value: unknown }[],
    schemaVersion = 1,
    keyId = 1,
  ): Promise<EnvelopeB64[]> {
    await ready()
    const { ak, userId } = this.requireUnlocked()
    return items.map(({ recordId, value }) => {
      const env = encryptRecord(
        ak,
        { userId, recordId, schemaVersion, keyId },
        value,
      )
      return {
        alg: env.alg,
        keyId: env.keyId,
        nonce: toBase64(env.nonce),
        ciphertext: toBase64(env.ciphertext),
      }
    })
  }

  async decrypt<T>(
    items: { recordId: string; envelope: EnvelopeB64 }[],
    schemaVersion = 1,
  ): Promise<T[]> {
    await ready()
    const { ak, userId } = this.requireUnlocked()
    return items.map(({ recordId, envelope }) => {
      const meta: RecordMeta = {
        userId,
        recordId,
        schemaVersion,
        keyId: envelope.keyId,
      }
      const env: Envelope = {
        alg: envelope.alg,
        keyId: envelope.keyId,
        nonce: fromBase64(envelope.nonce),
        ciphertext: fromBase64(envelope.ciphertext),
      }
      return decryptRecord<T>(ak, meta, env)
    })
  }

  /**
   * Server ids for sync (decision 8): HMAC of the local key under a key
   * derived from the account key, shaped as a UUIDv4. The server can't link
   * them to anything or read creation times, and every device of the
   * account computes the same id for the same record.
   */
  async syncIds(keys: string[]): Promise<string[]> {
    await ready()
    const { ak } = this.requireUnlocked()
    this.syncIdKey ??= await hkdf(ak, LABELS.syncId)
    const key = this.syncIdKey
    return keys.map((k) => {
      const mac = sodium
        .crypto_auth_hmacsha256(new TextEncoder().encode(k), key)
        .slice(0, 16)
      mac[6] = (mac[6]! & 0x0f) | 0x40 // version 4
      mac[8] = (mac[8]! & 0x3f) | 0x80 // RFC 4122 variant
      const hex = toHex(mac)
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    })
  }

  // -------------------------------------------------------------------------
  // Passkey unlock (§10.2): a WebAuthn PRF output, computed inside the
  // authenticator, derives a key that wraps the AK on this device. The PRF
  // output itself is never stored.

  async wrapForPrf(prf: Uint8Array): Promise<WrappedB64> {
    await ready()
    const { ak, userId } = this.requireUnlocked()
    const key = await hkdf(prf, LABELS.prfKek)
    try {
      return b64(wrapKey(key, ak, LABELS.wrapUnderPrf, userId))
    } finally {
      wipe(key, prf)
    }
  }

  async unlockWithPrf(
    userId: string,
    prf: Uint8Array,
    wrapped: WrappedB64,
  ): Promise<void> {
    await ready()
    const key = await hkdf(prf, LABELS.prfKek)
    try {
      const ak = unwrapKey(key, unb64(wrapped), LABELS.wrapUnderPrf, userId)
      this.lock()
      this.ak = ak
      this.userId = userId
    } finally {
      wipe(key, prf)
    }
  }

  // -------------------------------------------------------------------------
  // "Stay unlocked on this device" (§10.4): the AK encrypted under a
  // non-extractable AES-GCM key that only this browser profile can use.

  async rememberDevice(): Promise<void> {
    const { ak, userId } = this.requireUnlocked()
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const blob = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: new TextEncoder().encode(
            `${LABELS.wrapDevice}|${userId}`,
          ),
        },
        key,
        ak as BufferSource,
      ),
    )
    await this.device.put(userId, { key, iv, blob })
  }

  async forgetDevice(userId: string): Promise<void> {
    await this.device.delete(userId)
  }

  /** Unlock from this device's stored key; false if there isn't one. */
  async unlockFromDevice(userId: string): Promise<boolean> {
    await ready()
    const stored = await this.device.get(userId)
    if (!stored) return false
    const ak = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: stored.iv as BufferSource,
          additionalData: new TextEncoder().encode(
            `${LABELS.wrapDevice}|${userId}`,
          ),
        },
        stored.key,
        stored.blob as BufferSource,
      ),
    )
    this.lock()
    this.ak = ak
    this.userId = userId
    return true
  }
}

// Cryptographic building blocks (PLAN.md §10). Pure functions over byte
// arrays; the worker (worker.ts) holds keys and calls these.
//
// - Argon2id (libsodium crypto_pwhash): password → MasterKey
// - HKDF-SHA256 (WebCrypto): MasterKey → AuthKey, KEK; recovery phrase → key
// - XChaCha20-Poly1305 (libsodium): record encryption and key wrapping
// All symmetric keys are 256 bits (§10.8).

import sodium from 'libsodium-wrappers-sumo'

export const KEY_BYTES = 32
export const NONCE_BYTES = 24
export const SALT_BYTES = 16

/** Algorithm suite 1 (§10.8): Argon2id + HKDF-SHA256 + XChaCha20-Poly1305. */
export const ALG = 1

export interface KdfParams {
  /** Parameter set version, stored per user so it can be raised later. */
  v: 1
  /** Argon2id iterations. */
  ops: number
  /** Argon2id memory in bytes. */
  mem: number
}

export const DEFAULT_KDF: KdfParams = { v: 1, ops: 3, mem: 64 * 1024 * 1024 }

const enc = new TextEncoder()
const dec = new TextDecoder()

export async function ready(): Promise<void> {
  await sodium.ready
}

export function randomBytes(n: number): Uint8Array {
  return sodium.randombytes_buf(n)
}

/** Password → 32-byte MasterKey. Unicode is NFKC-normalised first. */
export function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  kdf: KdfParams,
): Uint8Array {
  if (salt.length !== SALT_BYTES) throw new Error('salt must be 16 bytes')
  return sodium.crypto_pwhash(
    KEY_BYTES,
    enc.encode(password.normalize('NFKC')),
    salt,
    kdf.ops,
    kdf.mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )
}

/** HKDF-SHA256 with an empty salt and a text label as `info`. */
export async function hkdf(
  ikm: Uint8Array,
  label: string,
  length = KEY_BYTES,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ikm as BufferSource,
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(label),
    },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

export const LABELS = {
  auth: 'dayrule/auth/v1',
  kek: 'dayrule/kek/v1',
  recovery: 'dayrule/recovery/v1',
  recoveryProof: 'dayrule/recovery-proof/v1',
  wrapUnderKek: 'dayrule/wrap/password/v1',
  wrapRecovery: 'dayrule/wrap/recovery/v1',
  wrapDevice: 'dayrule/wrap/device/v1',
  record: 'dayrule/record/v1',
  syncId: 'dayrule/sync-id/v1',
  /** Passkey unlock: WebAuthn PRF output → key that wraps the AK (§10.2). */
  prfKek: 'dayrule/prf-kek/v1',
  wrapUnderPrf: 'dayrule/wrap/prf/v1',
} as const

export interface Sealed {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
  nonce?: Uint8Array,
): Sealed {
  const n = nonce ?? randomBytes(NONCE_BYTES)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    n,
    key,
  )
  return { nonce: n, ciphertext }
}

/** Throws if the key, nonce, AAD or ciphertext don't match. */
export function open(
  key: Uint8Array,
  sealed: Sealed,
  aad: Uint8Array,
): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sealed.ciphertext,
    aad,
    sealed.nonce,
    key,
  )
}

/** Wrap a key for storage on the server; the label binds what it's for. */
export function wrapKey(
  kek: Uint8Array,
  key: Uint8Array,
  label: string,
  userId: string,
  nonce?: Uint8Array,
): Sealed {
  return seal(kek, key, enc.encode(`${label}|${userId}`), nonce)
}

export function unwrapKey(
  kek: Uint8Array,
  wrapped: Sealed,
  label: string,
  userId: string,
): Uint8Array {
  return open(kek, wrapped, enc.encode(`${label}|${userId}`))
}

// ---------------------------------------------------------------------------
// Padding (§10.3): plaintext is padded to a bucket so ciphertext sizes
// reveal less. ISO/IEC 7816-4 style: 0x80 then zeros.

const SMALL_BUCKETS = [256, 512, 1024, 2048]

export function bucketSize(n: number): number {
  for (const b of SMALL_BUCKETS) if (n <= b) return b
  return Math.ceil(n / 4096) * 4096
}

export function pad(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(bucketSize(data.length + 1))
  out.set(data)
  out[data.length] = 0x80
  return out
}

export function unpad(data: Uint8Array): Uint8Array {
  let i = data.length - 1
  while (i >= 0 && data[i] === 0) i--
  if (i < 0 || data[i] !== 0x80) throw new Error('bad padding')
  return data.subarray(0, i)
}

// ---------------------------------------------------------------------------
// Records (§10.3)

export interface RecordMeta {
  userId: string
  recordId: string
  schemaVersion: number
  keyId: number
}

export interface Envelope {
  alg: typeof ALG
  keyId: number
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** AAD binds a ciphertext to its user, record, schema, suite and key. */
export function recordAad(m: RecordMeta): Uint8Array {
  return enc.encode(
    `${LABELS.record}|${m.userId}|${m.recordId}|v${m.schemaVersion}|alg${ALG}|key${m.keyId}`,
  )
}

export function encryptRecord(
  ak: Uint8Array,
  meta: RecordMeta,
  value: unknown,
  nonce?: Uint8Array,
): Envelope {
  const sealed = seal(
    ak,
    pad(enc.encode(JSON.stringify(value))),
    recordAad(meta),
    nonce,
  )
  return { alg: ALG, keyId: meta.keyId, ...sealed }
}

export function decryptRecord<T>(
  ak: Uint8Array,
  meta: RecordMeta,
  env: Envelope,
): T {
  if (env.alg !== ALG) throw new Error(`unsupported algorithm suite ${env.alg}`)
  if (env.keyId !== meta.keyId) throw new Error('key id mismatch')
  return JSON.parse(dec.decode(unpad(open(ak, env, recordAad(meta))))) as T
}

/** Best-effort wipe of key material (JS can't guarantee it). */
export function wipe(...keys: (Uint8Array | null | undefined)[]): void {
  for (const k of keys) if (k) sodium.memzero(k)
}

export function toBase64(b: Uint8Array): string {
  return sodium.to_base64(b, sodium.base64_variants.ORIGINAL)
}

export function fromBase64(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL)
}

export function toHex(b: Uint8Array): string {
  return sodium.to_hex(b)
}

export function fromHex(s: string): Uint8Array {
  return sodium.from_hex(s)
}

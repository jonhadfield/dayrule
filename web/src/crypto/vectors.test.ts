// @vitest-environment node
/// <reference types="node" />
// Known-answer vectors shared with the Go server (docs/crypto-vectors.json,
// PLAN.md §10.6). Regenerate deliberately with UPDATE_CRYPTO_VECTORS=1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  bucketSize,
  decryptRecord,
  deriveMasterKey,
  encryptRecord,
  fromHex,
  hkdf,
  LABELS,
  pad,
  ready,
  toHex,
  unpad,
  unwrapKey,
  wrapKey,
  type KdfParams,
} from './primitives'
import { fromPhrase, recoveryKey, toPhrase } from './recovery'

const FILE = new URL('../../../docs/crypto-vectors.json', import.meta.url)
const SHARED = new URL(
  '../../../docs/shared/crypto-vectors.json',
  import.meta.url,
)

function syncIdFrom(key: string, syncIdKey: Uint8Array): string {
  const mac = createHmac('sha256', Buffer.from(syncIdKey))
    .update(key)
    .digest()
    .subarray(0, 16)
  mac[6] = (mac[6]! & 0x0f) | 0x40
  mac[8] = (mac[8]! & 0x3f) | 0x80
  const hex = mac.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const INPUT = {
  password: 'correct horse battery staple ✓ Ünïcode',
  salt: '000102030405060708090a0b0c0d0e0f',
  kdf: { v: 1, ops: 3, mem: 67108864 } satisfies KdfParams,
  userId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
  accountKey: '2a'.repeat(32),
  wrapNonce: '11'.repeat(24),
  recoveryEntropy: '7f'.repeat(16) + '01'.repeat(16),
  recordId: '0c9b8a7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d',
  recordNonce: '22'.repeat(24),
  record: {
    type: 'todo',
    title: 'Buy milk',
    notes: 'semi-skimmed',
    tonight: false,
  },
}

async function compute() {
  const mk = deriveMasterKey(INPUT.password, fromHex(INPUT.salt), INPUT.kdf)
  const authKey = await hkdf(mk, LABELS.auth)
  const kek = await hkdf(mk, LABELS.kek)
  const ak = fromHex(INPUT.accountKey)
  const wrappedPw = wrapKey(
    kek,
    ak,
    LABELS.wrapUnderKek,
    INPUT.userId,
    fromHex(INPUT.wrapNonce),
  )
  const phrase = toPhrase(fromHex(INPUT.recoveryEntropy))
  const rk = await recoveryKey(fromHex(INPUT.recoveryEntropy))
  const wrappedRecovery = wrapKey(
    rk,
    ak,
    LABELS.wrapRecovery,
    INPUT.userId,
    fromHex(INPUT.wrapNonce),
  )
  const meta = {
    userId: INPUT.userId,
    recordId: INPUT.recordId,
    schemaVersion: 1,
    keyId: 1,
  }
  const env = encryptRecord(ak, meta, INPUT.record, fromHex(INPUT.recordNonce))

  // W0 additions: recovery proof, sync id, sync wire envelope ({k,v} / {k,d}).
  const recoveryProof = await hkdf(
    fromHex(INPUT.recoveryEntropy),
    LABELS.recoveryProof,
  )
  const syncIdKey = await hkdf(ak, LABELS.syncId)
  const entityKey = `todos/${INPUT.recordId}`
  const wireId = syncIdFrom(entityKey, syncIdKey)
  const syncPayload = { k: entityKey, v: INPUT.record }
  const syncMeta = {
    userId: INPUT.userId,
    recordId: `sync/${wireId}`,
    schemaVersion: 1,
    keyId: 1,
  }
  const syncEnv = encryptRecord(
    ak,
    syncMeta,
    syncPayload,
    fromHex(INPUT.recordNonce),
  )
  const tombPayload = { k: entityKey, d: '0cre66i9s-0000-dev1' }
  const tombEnv = encryptRecord(
    ak,
    syncMeta,
    tombPayload,
    fromHex(INPUT.recordNonce),
  )
  const uppercaseMeta = {
    ...syncMeta,
    userId: INPUT.userId.toUpperCase(),
  }
  let uppercaseDecryptFails = false
  try {
    decryptRecord(ak, uppercaseMeta, syncEnv)
  } catch {
    uppercaseDecryptFails = true
  }

  return {
    input: INPUT,
    output: {
      masterKey: toHex(mk),
      authKey: toHex(authKey),
      kek: toHex(kek),
      wrappedAccountKeyPassword: toHex(wrappedPw.ciphertext),
      recoveryPhrase: phrase.join(' '),
      recoveryKey: toHex(rk),
      wrappedAccountKeyRecovery: toHex(wrappedRecovery.ciphertext),
      recordAad: `${LABELS.record}|${meta.userId}|${meta.recordId}|v1|alg1|key1`,
      recordPlaintextJson: JSON.stringify(INPUT.record),
      recordCiphertext: toHex(env.ciphertext),
      recoveryProof: toHex(recoveryProof),
      syncIdKey: toHex(syncIdKey),
      syncEntityKey: entityKey,
      syncWireId: wireId,
      syncRecordAad: `${LABELS.record}|${syncMeta.userId}|${syncMeta.recordId}|v1|alg1|key1`,
      syncPlaintextJson: JSON.stringify(syncPayload),
      syncCiphertext: toHex(syncEnv.ciphertext),
      syncTombstonePlaintextJson: JSON.stringify(tombPayload),
      syncTombstoneCiphertext: toHex(tombEnv.ciphertext),
      uppercaseUserIdDecryptFails: uppercaseDecryptFails,
      padBuckets: [1, 255, 256, 511, 2047, 2048, 5000].map((n) =>
        bucketSize(n + 1),
      ),
    },
  }
}

beforeAll(ready)

describe('crypto vectors', () => {
  it('match docs/crypto-vectors.json (shared with Go)', async () => {
    const got = await compute()
    if (process.env.UPDATE_CRYPTO_VECTORS === '1' || !existsSync(FILE)) {
      const body = JSON.stringify(got, null, 2) + '\n'
      writeFileSync(FILE, body)
      writeFileSync(SHARED, body)
    }
    expect(got).toEqual(JSON.parse(readFileSync(FILE, 'utf8')))
    expect(got).toEqual(JSON.parse(readFileSync(SHARED, 'utf8')))
    expect(got.output.uppercaseUserIdDecryptFails).toBe(true)
  }, 30_000)
})

describe('primitives', () => {
  const meta = { userId: 'u', recordId: 'r', schemaVersion: 1, keyId: 1 }
  // A function, not a constant: describe bodies run before beforeAll(ready).
  const key = () => fromHex('2a'.repeat(32))

  it('round-trips a record and rejects tampering or the wrong binding', () => {
    const ak = key()
    const env = encryptRecord(ak, meta, { title: 'x' })
    expect(decryptRecord(ak, meta, env)).toEqual({ title: 'x' })
    expect(() =>
      decryptRecord(ak, { ...meta, recordId: 'other' }, env),
    ).toThrow()
    expect(() => decryptRecord(ak, { ...meta, userId: 'other' }, env)).toThrow()
    const bad = { ...env, ciphertext: env.ciphertext.slice() }
    bad.ciphertext[0] = (bad.ciphertext[0] ?? 0) ^ 1
    expect(() => decryptRecord(ak, meta, bad)).toThrow()
    expect(() => decryptRecord(fromHex('2b'.repeat(32)), meta, env)).toThrow()
  })

  it('binds wrapped keys to their purpose and user', () => {
    const ak = key()
    const kek = fromHex('33'.repeat(32))
    const w = wrapKey(kek, ak, LABELS.wrapUnderKek, 'u')
    expect(unwrapKey(kek, w, LABELS.wrapUnderKek, 'u')).toEqual(ak)
    expect(() => unwrapKey(kek, w, LABELS.wrapRecovery, 'u')).toThrow()
    expect(() => unwrapKey(kek, w, LABELS.wrapUnderKek, 'v')).toThrow()
  })

  it('pads into fixed buckets', () => {
    expect(
      [1, 255, 256, 511, 2047, 2048, 5000].map((n) => bucketSize(n + 1)),
    ).toEqual([256, 256, 512, 512, 2048, 4096, 8192])
    for (const n of [0, 1, 255, 300, 4095]) {
      const data = new Uint8Array(n).fill(7)
      expect(unpad(pad(data))).toEqual(data)
    }
  })

  it('round-trips a recovery phrase and rejects typos', () => {
    const entropy = fromHex('7f'.repeat(32))
    const words = toPhrase(entropy)
    expect(words).toHaveLength(24)
    expect(fromPhrase(`  ${words.join('   ').toUpperCase()} `)).toEqual(entropy)
    const typo = [...words]
    typo[3] = typo[3] === 'abandon' ? 'ability' : 'abandon'
    expect(() => fromPhrase(typo.join(' '))).toThrow()
  })
})

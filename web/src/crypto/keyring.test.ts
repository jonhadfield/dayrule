// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { Keyring, type DeviceStore } from './keyring'
import { ready, type KdfParams } from './primitives'

// Small Argon2 parameters keep the tests fast; real accounts use DEFAULT_KDF.
const FAST: KdfParams = { v: 1, ops: 1, mem: 8 * 1024 * 1024 }
const USER = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'

function memoryStore(): DeviceStore {
  const m = new Map<
    string,
    { key: CryptoKey; iv: Uint8Array; blob: Uint8Array }
  >()
  return {
    get: async (u) => m.get(u),
    put: async (u, v) => void m.set(u, v),
    delete: async (u) => void m.delete(u),
  }
}

beforeAll(ready)

describe('Keyring', () => {
  it('signs up, signs in on another device and reads the same records', async () => {
    const a = new Keyring(memoryStore())
    const acct = await a.createAccount('pa55word', USER, FAST)
    expect(acct.recoveryWords).toHaveLength(24)
    expect(await a.recoveryProof(acct.recoveryWords.join(' '))).toBe(
      acct.recoveryProof,
    )
    const [env] = await a.encrypt([
      { recordId: 'r1', value: { title: 'Buy milk' } },
    ])

    const b = new Keyring(memoryStore())
    const authKey = await b.beginLogin('pa55word', acct.salt, acct.kdf)
    expect(authKey).toBe(acct.authKey)
    await b.finishLogin(USER, acct.wrappedPassword)
    expect(await b.decrypt([{ recordId: 'r1', envelope: env! }])).toEqual([
      { title: 'Buy milk' },
    ])
  })

  it('a wrong password yields a different AuthKey and cannot unwrap', async () => {
    const a = new Keyring(memoryStore())
    const acct = await a.createAccount('right', USER, FAST)
    const b = new Keyring(memoryStore())
    expect(await b.beginLogin('wrong', acct.salt, acct.kdf)).not.toBe(
      acct.authKey,
    )
    await expect(b.finishLogin(USER, acct.wrappedPassword)).rejects.toThrow()
    expect(b.isUnlocked()).toBe(false)
  })

  it('recovers with the phrase and a new password, keeping the same data key', async () => {
    const a = new Keyring(memoryStore())
    const acct = await a.createAccount('forgotten', USER, FAST)
    const [env] = await a.encrypt([{ recordId: 'r1', value: 42 }])

    const b = new Keyring(memoryStore())
    const creds = await b.recover(
      acct.recoveryWords.join(' '),
      USER,
      acct.wrappedRecovery,
      'new-one',
      FAST,
    )
    expect(await b.decrypt([{ recordId: 'r1', envelope: env! }])).toEqual([42])

    const c = new Keyring(memoryStore())
    await c.beginLogin('new-one', creds.salt, creds.kdf)
    await c.finishLogin(USER, creds.wrappedPassword)
    expect(await c.decrypt([{ recordId: 'r1', envelope: env! }])).toEqual([42])
  })

  it('changes the password without re-encrypting', async () => {
    const a = new Keyring(memoryStore())
    await a.createAccount('old', USER, FAST)
    const [env] = await a.encrypt([{ recordId: 'r', value: 'x' }])
    const creds = await a.changePassword('new', FAST)
    const b = new Keyring(memoryStore())
    await b.beginLogin('new', creds.salt, creds.kdf)
    await b.finishLogin(USER, creds.wrappedPassword)
    expect(await b.decrypt([{ recordId: 'r', envelope: env! }])).toEqual(['x'])
  })

  it('locks, then unlocks from the remembered device key', async () => {
    const store = memoryStore()
    const a = new Keyring(store)
    await a.createAccount('pw', USER, FAST)
    const [env] = await a.encrypt([{ recordId: 'r', value: true }])
    await a.rememberDevice()
    a.lock()
    await expect(a.encrypt([{ recordId: 'r', value: 1 }])).rejects.toThrow(
      'locked',
    )
    expect(await a.unlockFromDevice(USER)).toBe(true)
    expect(await a.decrypt([{ recordId: 'r', envelope: env! }])).toEqual([true])
    await a.forgetDevice(USER)
    a.lock()
    expect(await a.unlockFromDevice(USER)).toBe(false)
  })
})

describe('sync ids', () => {
  it('are stable per account, unlinkable across accounts, and UUIDv4-shaped', async () => {
    const a = new Keyring(memoryStore())
    const acct = await a.createAccount('pw', USER, FAST)
    const [x, y] = await a.syncIds(['todos/1', 'todos/2'])
    expect(x).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(x).not.toBe(y)

    const sameAccount = new Keyring(memoryStore())
    await sameAccount.beginLogin('pw', acct.salt, acct.kdf)
    await sameAccount.finishLogin(USER, acct.wrappedPassword)
    expect(await sameAccount.syncIds(['todos/1'])).toEqual([x])

    const other = new Keyring(memoryStore())
    await other.createAccount('pw', USER, FAST)
    expect(await other.syncIds(['todos/1'])).not.toEqual([x])
  })
})

describe('passkey unlock', () => {
  it('unlocks with the same PRF output only, and wipes it after use', async () => {
    const a = new Keyring(memoryStore())
    await a.createAccount('pw', USER, FAST)
    const [id] = await a.syncIds(['todos/1'])
    const prf = new Uint8Array(32).fill(7)
    const wrapped = await a.wrapForPrf(prf.slice())

    const fresh = new Keyring(memoryStore())
    await expect(
      fresh.unlockWithPrf(USER, new Uint8Array(32).fill(8), wrapped),
    ).rejects.toThrow()
    await expect(
      fresh.unlockWithPrf(
        '00000000-0000-4000-8000-000000000000',
        prf.slice(),
        wrapped,
      ),
    ).rejects.toThrow() // bound to the user id

    const given = prf.slice()
    await fresh.unlockWithPrf(USER, given, wrapped)
    expect(await fresh.syncIds(['todos/1'])).toEqual([id]) // same account key
    expect(given.every((b) => b === 0)).toBe(true) // wiped
  })
})

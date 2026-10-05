// @vitest-environment node
import { Hlc } from '../domain/hlc'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import { Keyring, type DeviceStore } from '../crypto/keyring'
import { ready, type KdfParams } from '../crypto/primitives'
import * as cmd from '../store/commands'
import { createEntityStore, type Clock } from '../store/store'
import { dataDbName, openEncryptedDB } from './encrypted'

const FAST: KdfParams = { v: 1, ops: 1, mem: 8 * 1024 * 1024 }
const noDevice: DeviceStore = {
  get: async () => undefined,
  put: async () => {},
  delete: async () => {},
}
let n = 0
const clock = (): Clock => {
  let t = new Date(2026, 9, 4, 9).getTime()
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${++n}`,
    hlc: new Hlc('test', () => t),
  }
}

beforeAll(ready)

describe('encrypted persistence', () => {
  it('stores only ciphertext and round-trips a store through a reopened DB', async () => {
    const userId = crypto.randomUUID()
    const keyring = new Keyring(noDevice)
    await keyring.createAccount('pw', userId, FAST)
    const db = openEncryptedDB(userId, keyring)
    const s = createEntityStore(undefined, clock())
    s.subscribeChanges((c) => void db.apply(c))

    const p = s.run('p', (d, env) =>
      cmd.createProject(d, env, { title: 'Secret project' }),
    )
    s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'Secret to-do',
        placement: { list: 'project', projectId: p.id },
      }),
    )
    s.run('mode', (d) => cmd.setDoneMode(d, 'daily'))
    await db.apply([])
    db.close()

    // Nothing readable at rest.
    const raw = new Dexie(dataDbName(userId))
    raw.version(1).stores({ records: 'id' })
    const dump = JSON.stringify(await raw.table('records').toArray())
    raw.close()
    expect(dump).not.toContain('Secret')
    expect(dump).not.toContain('daily')

    const reopened = openEncryptedDB(userId, keyring)
    expect(await reopened.load()).toEqual(s.entities)
    reopened.close()
  })

  it('cannot be read with another account key', async () => {
    const userId = crypto.randomUUID()
    const a = new Keyring(noDevice)
    await a.createAccount('pw', userId, FAST)
    const db = openEncryptedDB(userId, a)
    const s = createEntityStore(undefined, clock())
    s.subscribeChanges((c) => void db.apply(c))
    s.run('t', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    await db.apply([])
    db.close()

    const other = new Keyring(noDevice)
    await other.createAccount('pw', userId, FAST)
    await expect(openEncryptedDB(userId, other).load()).rejects.toThrow()
  })
})

// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { ApiError } from '../account/api'
import { Keyring, type DeviceStore } from '../crypto/keyring'
import { ready, type KdfParams } from '../crypto/primitives'
import { Hlc } from '../domain/hlc'
import type { Entities } from '../domain/types'
import { openEncryptedDB } from '../persistence/encrypted'
import * as cmd from '../store/commands'
import { createEntityStore, type EntityStore } from '../store/store'
import {
  SyncBlockedError,
  SyncEngine,
  type PushResult,
  type SyncTransport,
  type WireRecord,
} from './engine'

const FAST: KdfParams = { v: 1, ops: 1, mem: 8 * 1024 * 1024 }
const noDevice: DeviceStore = {
  get: async () => undefined,
  put: async () => {},
  delete: async () => {},
}

/** The server's sync semantics (server/internal/store/records.go), in memory. */
class FakeServer {
  records = new Map<string, WireRecord & { seq: number }>()
  next = 1
  floor = 0
  quotaFull = false
  offline = false

  transport(): SyncTransport {
    const check = () => {
      if (this.offline) throw new ApiError(0, 'offline', 'offline')
    }
    return {
      head: async () => (check(), { seq: this.next - 1, floor: this.floor }),
      pull: async (since, full) => {
        check()
        if (since > 0 && since < this.floor && !full)
          throw new ApiError(410, 'resync', 'resync')
        const all = [...this.records.values()]
          .filter((r) => r.seq > since)
          .sort((a, b) => a.seq - b.seq)
        const page = all.slice(0, 2) // tiny pages to exercise paging
        return {
          records: structuredClone(page),
          cursor: page.at(-1)?.seq ?? since,
          hasMore: all.length > page.length,
        }
      },
      push: async (records) => {
        check()
        const results: PushResult[] = records.map((r) => {
          const cur = this.records.get(r.id)
          if ((cur?.seq ?? 0) !== (r.baseSeq ?? 0))
            return { id: r.id, seq: cur?.seq ?? 0, conflict: true }
          if (this.quotaFull && !r.tombstone)
            return { id: r.id, seq: cur?.seq ?? 0, error: 'quota' }
          const seq = this.next++
          this.records.set(r.id, { ...r, baseSeq: undefined, seq })
          return { id: r.id, seq }
        })
        return { results, head: this.next - 1 }
      },
    }
  }

  /** The daily clean-up: purge tombstones (all of them, for the test). */
  gc() {
    for (const [id, r] of this.records) {
      if (r.tombstone) {
        this.records.delete(id)
        this.floor = Math.max(this.floor, r.seq)
      }
    }
  }
}

interface Device {
  store: EntityStore
  engine: SyncEngine
}

const userId = crypto.randomUUID()
let account: Awaited<ReturnType<Keyring['createAccount']>>
let first: Keyring

beforeAll(async () => {
  await ready()
  first = new Keyring(noDevice)
  account = await first.createAccount('pw', userId, FAST)
})

let deviceN = 0
/** One wall clock for all devices, so "later" in a test is later in time. */
let wall = new Date(2026, 9, 4, 9).getTime()
async function device(server: FakeServer, initial?: Entities): Promise<Device> {
  const me = ++deviceN
  const keyring = new Keyring(noDevice)
  await keyring.beginLogin('pw', account.salt, account.kdf)
  await keyring.finishLogin(userId, account.wrappedPassword)
  // Each device has its own local database.
  const db = openEncryptedDB(`${userId}-${me}`, keyring)
  let n = 0
  const store = createEntityStore(initial, {
    now: () => new Date((wall += 1000)),
    newId: () => `d${me}-${++n}`,
    hlc: new Hlc(`dev${me}`, () => (wall += 1)),
  })
  store.subscribeChanges((c, meta) => void db.apply(c, meta))
  // Keyring.decrypt needs the AAD userId; the record cipher is shared.
  return {
    store,
    engine: new SyncEngine(store, db, keyring, server.transport()),
  }
}

const titles = (d: Device) =>
  Object.values(d.store.entities.todos)
    .map((t) => t.title)
    .sort()

const add = (d: Device, title: string) =>
  d.store.run('add', (dr, env) =>
    cmd.createTodo(dr, env, { title, placement: { list: 'inbox' } }),
  )

describe('sync engine', () => {
  it('syncs creates, edits and deletes between two devices', async () => {
    const server = new FakeServer()
    const a = await device(server)
    const b = await device(server)
    const t1 = add(a, 'one')
    add(a, 'two')
    add(a, 'three')
    await a.engine.sync()
    await b.engine.sync()
    expect(titles(b)).toEqual(['one', 'three', 'two'])

    b.store.run('edit', (d, env) =>
      cmd.updateTodo(d, env, t1.id, { notes: 'from b' }),
    )
    a.store.run('edit', (d, env) =>
      cmd.updateTodo(d, env, t1.id, { title: 'ONE' }),
    )
    await b.engine.sync()
    await a.engine.sync() // conflict on t1: pull, merge, push again
    await b.engine.sync()
    expect(a.store.entities.todos[t1.id]).toMatchObject({
      title: 'ONE',
      notes: 'from b',
    })
    expect(b.store.entities.todos[t1.id]).toMatchObject({
      title: 'ONE',
      notes: 'from b',
    })

    a.store.run('delete', (d) => d.remove('todos', t1.id))
    await a.engine.sync()
    await b.engine.sync()
    expect(titles(b)).toEqual(['three', 'two'])
  })

  it('stores only ciphertext and unlinkable ids on the server', async () => {
    const server = new FakeServer()
    const a = await device(server)
    add(a, 'very secret title')
    await a.engine.sync()
    const dump = JSON.stringify([...server.records.values()])
    expect(dump).not.toContain('secret')
    expect(dump).not.toContain('todos/')
    // Server ids are opaque UUIDs; no local id appears anywhere.
    for (const r of server.records.values()) {
      expect(r.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
    for (const id of Object.keys(a.store.entities.todos)) {
      expect(dump).not.toContain(`"${id}"`)
    }
  })

  it('converges after both devices edit offline', async () => {
    const server = new FakeServer()
    const a = await device(server)
    const b = await device(server)
    const shared = add(a, 'shared')
    await a.engine.sync()
    await b.engine.sync()

    server.offline = true
    add(a, 'a only')
    add(b, 'b only')
    a.store.run('x', (d, env) =>
      cmd.updateTodo(d, env, shared.id, { title: 'by a' }),
    )
    b.store.run('x', (d, env) =>
      cmd.updateTodo(d, env, shared.id, { title: 'by b' }),
    ) // later
    await expect(a.engine.sync()).rejects.toThrow()
    server.offline = false

    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(titles(a)).toEqual(['a only', 'b only', 'by b'])
    expect(a.store.entities).toEqual(b.store.entities)
  })

  it('an edit after a deletion revives the record; an older one does not', async () => {
    const server = new FakeServer()
    const a = await device(server)
    const b = await device(server)
    const t = add(a, 'x')
    await a.engine.sync()
    await b.engine.sync()

    a.store.run('del', (d) => d.remove('todos', t.id))
    b.store.run('edit', (d, env) =>
      cmd.updateTodo(d, env, t.id, { notes: 'later edit' }),
    )
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(a.store.entities.todos[t.id]?.notes).toBe('later edit')
    expect(b.store.entities.todos[t.id]?.notes).toBe('later edit')

    b.store.run('edit', (d, env) =>
      cmd.updateTodo(d, env, t.id, { notes: 'old' }),
    )
    a.store.run('del', (d) => d.remove('todos', t.id)) // later than b's edit
    await b.engine.sync()
    await a.engine.sync()
    await b.engine.sync()
    expect(a.store.entities.todos[t.id]).toBeUndefined()
    expect(b.store.entities.todos[t.id]).toBeUndefined()
  })

  it('uploads data that was on the device before sync existed', async () => {
    const server = new FakeServer()
    const seed = await device(server)
    add(seed, 'from before sync')
    const old = await device(server, seed.store.entities)
    await old.engine.sync()
    const fresh = await device(server)
    await fresh.engine.sync()
    expect(titles(fresh)).toEqual(['from before sync'])
  })

  it('resyncs fully when tombstones were purged, dropping deleted records', async () => {
    const server = new FakeServer()
    const a = await device(server)
    const b = await device(server)
    const gone = add(a, 'gone')
    add(a, 'kept')
    await a.engine.sync()
    await b.engine.sync()

    a.store.run('del', (d) => d.remove('todos', gone.id))
    await a.engine.sync()
    server.gc() // b never saw the tombstone
    add(a, 'newer')
    await a.engine.sync()

    await b.engine.sync()
    expect(titles(b)).toEqual(['kept', 'newer'])
  })

  it('reports a full account and keeps changes queued', async () => {
    const server = new FakeServer()
    const a = await device(server)
    await a.engine.sync()
    server.quotaFull = true
    add(a, 'no room')
    await expect(a.engine.sync()).rejects.toBeInstanceOf(SyncBlockedError)
    server.quotaFull = false
    await a.engine.sync()
    const b = await device(server)
    await b.engine.sync()
    expect(titles(b)).toEqual(['no room'])
  })
})

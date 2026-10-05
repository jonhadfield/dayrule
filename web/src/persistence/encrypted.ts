// Encrypted local persistence (PLAN.md §10.4): IndexedDB holds only
// ciphertext. Each entity is one record, encrypted by the crypto worker and
// bound (via AAD) to "<collection>/<id>", so records can't be swapped.
// It also keeps the sync bookkeeping (PLAN.md §11.4): an outbox of local
// changes to push, the server sequence last seen per record, local
// tombstones and the pull cursor. None of that is user content.

import Dexie, { type Table } from 'dexie'
import { emptyEntities, type Entities, type Settings } from '../domain/types'
import type { EnvelopeB64 } from '../crypto/keyring'
import type { Change, Collection } from '../store/draft'
import type { Persistence } from './persistence'

/** The crypto worker's record API, or a Keyring directly in tests. */
export interface RecordCipher {
  encrypt(
    items: { recordId: string; value: unknown }[],
  ): Promise<EnvelopeB64[]> | EnvelopeB64[]
  decrypt(
    items: { recordId: string; envelope: EnvelopeB64 }[],
  ): Promise<unknown[]> | unknown[]
}

export const COLLECTIONS = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
] as const satisfies readonly Collection[]

export const SETTINGS_KEY = 'settings/settings'

interface Row {
  /** "<collection>/<id>" — also the AAD record id. */
  id: string
  env: EnvelopeB64
}

/** A local change waiting to be pushed; `rev` detects re-edits mid-push. */
export interface OutboxRow {
  key: string
  rev: number
}

class DataDB extends Dexie {
  records!: Table<Row, string>
  outbox!: Table<OutboxRow, string>
  /** Last server sequence seen per record key. */
  syncmeta!: Table<{ key: string; seq: number }, string>
  /** Deleted records' keys and deletion stamps (resolve stale updates). */
  tombstones!: Table<{ key: string; hlc: string }, string>
  state!: Table<{ k: string; v: unknown }, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({ records: 'id' })
    this.version(2).stores({
      records: 'id',
      outbox: 'key',
      syncmeta: 'key',
      tombstones: 'key',
      state: 'k',
    })
  }
}

/** Sync bookkeeping for one account's local database. */
export interface SyncState {
  outbox(limit: number): Promise<OutboxRow[]>
  pendingKeys(): Promise<string[]>
  /** Remove pushed entries, unless they were changed again meanwhile. */
  clearOutbox(done: OutboxRow[]): Promise<void>
  markDirty(keys: string[]): Promise<void>
  seqs(keys: string[]): Promise<Map<string, number>>
  setSeqs(entries: { key: string; seq: number }[]): Promise<void>
  allSeqKeys(): Promise<string[]>
  clearSeqs(): Promise<void>
  tombstone(key: string): Promise<string | undefined>
  getState<T>(k: string): Promise<T | undefined>
  setState(k: string, v: unknown): Promise<void>
}

let revCounter = 0
const nextRev = () => Date.now() * 1000 + (revCounter++ % 1000)

/** The local record key of a change: "<collection>/<id>". */
export function keyOf(c: Change): string {
  return c.kind === 'settings' ? SETTINGS_KEY : `${c.collection}/${c.id}`
}

export function dataDbName(userId: string): string {
  return `dayrule-data-${userId}`
}

export type EncryptedDB = Persistence & {
  /** Resolves once every queued write has finished. */
  idle(): Promise<void>
  isEmpty(): Promise<boolean>
  replaceAll(e: Entities): Promise<void>
  sync: SyncState
}

export function openEncryptedDB(
  userId: string,
  cipher: RecordCipher,
): EncryptedDB {
  const db = new DataDB(dataDbName(userId))
  let queue: Promise<void> = Promise.resolve()

  const rowsFor = async (
    items: { id: string; value: unknown }[],
  ): Promise<Row[]> => {
    if (items.length === 0) return []
    const envs = await cipher.encrypt(
      items.map((i) => ({ recordId: i.id, value: i.value })),
    )
    return items.map((i, n) => ({ id: i.id, env: envs[n]! }))
  }

  return {
    async load() {
      const rows = await db.records.toArray()
      const values = await cipher.decrypt(
        rows.map((r) => ({ recordId: r.id, envelope: r.env })),
      )
      const e = emptyEntities()
      rows.forEach((row, n) => {
        if (row.id === SETTINGS_KEY) {
          e.settings = values[n] as Settings
          return
        }
        const slash = row.id.indexOf('/')
        const collection = row.id.slice(0, slash) as Collection
        if (!COLLECTIONS.includes(collection)) return
        ;(e[collection] as Record<string, unknown>)[row.id.slice(slash + 1)] =
          values[n]
      })
      return e
    },

    apply(changes, meta) {
      const local = (meta?.source ?? 'local') === 'local'
      const run = async () => {
        const puts: { id: string; value: unknown }[] = []
        const deletes: string[] = []
        for (const c of changes) {
          if (c.kind === 'settings')
            puts.push({ id: SETTINGS_KEY, value: c.after })
          else if (c.after) puts.push({ id: keyOf(c), value: c.after })
          else deletes.push(keyOf(c))
        }
        // Encrypt before opening the transaction: IndexedDB transactions
        // auto-commit if they wait on anything else.
        const rows = await rowsFor(puts)
        const tombstones = changes
          .filter((c) => c.kind === 'entity' && !c.after)
          .map((c) => ({ key: keyOf(c), hlc: c.hlc ?? '' }))
        await db.transaction(
          'rw',
          [db.records, db.outbox, db.tombstones],
          async () => {
            if (rows.length) await db.records.bulkPut(rows)
            if (deletes.length) await db.records.bulkDelete(deletes)
            if (tombstones.length) await db.tombstones.bulkPut(tombstones)
            if (puts.length)
              await db.tombstones.bulkDelete(puts.map((p) => p.id))
            // Local edits are queued for push; synced ones are already there.
            if (local)
              await db.outbox.bulkPut(
                changes.map((c) => ({ key: keyOf(c), rev: nextRev() })),
              )
          },
        )
      }
      queue = queue.then(run, run)
      return queue
    },

    idle() {
      return queue
    },

    async isEmpty() {
      return (await db.records.count()) === 0
    },

    /** Write a whole entity set (used to import pre-encryption data). */
    async replaceAll(e) {
      const items: { id: string; value: unknown }[] = [
        { id: SETTINGS_KEY, value: e.settings },
      ]
      for (const c of COLLECTIONS) {
        for (const [id, value] of Object.entries(e[c]))
          items.push({ id: `${c}/${id}`, value })
      }
      const rows = await rowsFor(items)
      await db.transaction('rw', db.records, async () => {
        await db.records.clear()
        await db.records.bulkPut(rows)
      })
    },

    sync: {
      outbox: (limit) => db.outbox.limit(limit).toArray(),
      pendingKeys: () => db.outbox.toCollection().primaryKeys(),
      async clearOutbox(done) {
        await db.transaction('rw', db.outbox, async () => {
          for (const d of done) {
            const cur = await db.outbox.get(d.key)
            if (cur?.rev === d.rev) await db.outbox.delete(d.key)
          }
        })
      },
      async markDirty(keys) {
        await db.outbox.bulkPut(keys.map((key) => ({ key, rev: nextRev() })))
      },
      async seqs(keys) {
        const rows = await db.syncmeta.bulkGet(keys)
        return new Map(
          rows.flatMap((r) => (r ? [[r.key, r.seq] as const] : [])),
        )
      },
      async setSeqs(entries) {
        await db.syncmeta.bulkPut(entries)
      },
      allSeqKeys: () => db.syncmeta.toCollection().primaryKeys(),
      async clearSeqs() {
        await db.syncmeta.clear()
      },
      tombstone: async (key) => (await db.tombstones.get(key))?.hlc,
      getState: async <T>(k: string) =>
        (await db.state.get(k))?.v as T | undefined,
      async setState(k, v) {
        await db.state.put({ k, v })
      },
    },

    close() {
      db.close()
    },
  }
}

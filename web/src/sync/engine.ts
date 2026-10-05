// One sync cycle (PLAN.md §11.4): pull what changed since our cursor and
// merge it in, then push our outbox. Records travel encrypted; the server
// sees only keyed-HMAC ids (decision 8), sequence numbers and sizes.

import { ApiError } from '../account/api'
import type { EnvelopeB64 } from '../crypto/keyring'
import type { EncryptedDB } from '../persistence/encrypted'
import { SETTINGS_KEY } from '../persistence/encrypted'
import type { EntityStore } from '../store/store'
import { allKeys, incomingChanges, lookup } from './incoming'

export interface WireRecord {
  id: string
  seq?: number
  baseSeq?: number
  alg: 1
  keyId: number
  nonce: string
  ciphertext: string
  tombstone?: boolean
}

export interface PushResult {
  id: string
  seq: number
  conflict?: boolean
  error?: 'too_large' | 'quota'
}

export interface SyncTransport {
  head(): Promise<{ seq: number; floor: number }>
  /** `full`: paging through a download that started at zero. */
  pull(
    since: number,
    full: boolean,
  ): Promise<{ records: WireRecord[]; cursor: number; hasMore: boolean }>
  push(records: WireRecord[]): Promise<{ results: PushResult[]; head: number }>
}

/** The crypto worker's API, or a Keyring directly in tests. */
export interface SyncCrypto {
  syncIds(keys: string[]): Promise<string[]>
  encrypt(items: { recordId: string; value: unknown }[]): Promise<EnvelopeB64[]>
  decrypt(
    items: { recordId: string; envelope: EnvelopeB64 }[],
  ): Promise<unknown[]>
}

/** The encrypted payload: which record, and its value or deletion stamp. */
interface Payload {
  k: string
  v?: unknown
  d?: string
}

const PUSH_BATCH = 200
/** AAD record id for a synced record: bound to its server id. */
const aadId = (wireId: string) => `sync/${wireId}`

export class SyncBlockedError extends Error {
  readonly reason: 'too_large' | 'quota'
  constructor(reason: 'too_large' | 'quota') {
    super(
      reason === 'quota'
        ? 'Your account is full, so new changes stay on this device.'
        : 'A to-do is too large to sync. Shorten its notes.',
    )
    this.reason = reason
  }
}

export class SyncEngine {
  private readonly store: EntityStore
  private readonly db: EncryptedDB
  private readonly crypto: SyncCrypto
  private readonly net: SyncTransport

  constructor(
    store: EntityStore,
    db: EncryptedDB,
    crypto: SyncCrypto,
    net: SyncTransport,
  ) {
    this.store = store
    this.db = db
    this.crypto = crypto
    this.net = net
  }

  async cursor(): Promise<number> {
    return (await this.db.sync.getState<number>('cursor')) ?? 0
  }

  /** Pull, merge and push until nothing conflicts (a few rounds at most). */
  async sync(): Promise<void> {
    const s = this.db.sync
    // The first sync on this device uploads whatever is already here.
    if (!(await s.getState<boolean>('uploaded'))) {
      await s.markDirty(allKeys(this.store.entities))
      await s.setState('uploaded', true)
    }
    for (let round = 0; round < 4; round++) {
      await this.pull()
      if (!(await this.push())) return
    }
  }

  private async pull(): Promise<void> {
    const s = this.db.sync
    let cursor = await this.cursor()
    const full = cursor === 0
    const seen = new Set<string>()
    for (;;) {
      let page
      try {
        page = await this.net.pull(cursor, full)
      } catch (err) {
        // Deletions we never saw have been purged: download everything.
        if (err instanceof ApiError && err.status === 410 && cursor > 0) {
          await s.clearSeqs()
          await s.setState('cursor', 0)
          return this.pull()
        }
        throw err
      }
      if (page.records.length > 0) {
        const recs = page.records
        const payloads = (await this.crypto.decrypt(
          recs.map((r) => ({ recordId: aadId(r.id), envelope: envelope(r) })),
        )) as Payload[]
        const keys = payloads.map((p) => p.k)
        // The AAD binds each payload to its server id, and the id is
        // derived from the key, so a server can't present one record as
        // another.
        const ids = await this.crypto.syncIds(keys)
        if (ids.some((id, i) => id !== recs[i]!.id))
          throw new Error('sync record id mismatch')

        const tombs = new Map<string, string>()
        for (const k of keys) {
          const t = await s.tombstone(k)
          if (t !== undefined) tombs.set(k, t)
        }
        const { changes, pushBack } = incomingChanges(
          this.store.entities,
          payloads.map((p) => ({ key: p.k, value: p.v, deleted: p.d })),
          tombs,
        )
        this.store.applyRemote(changes, 'sync')
        await this.db.idle()
        await s.setSeqs(
          recs.map((r, i) => ({ key: keys[i]!, seq: r.seq ?? 0 })),
        )
        if (pushBack.length) await s.markDirty(pushBack)
        for (const k of keys) seen.add(k)
      }
      cursor = page.cursor
      await s.setState('cursor', cursor)
      if (!page.hasMore) break
    }
    if (full) await this.prune(seen)
  }

  /**
   * After downloading everything: records we hold that the server doesn't,
   * and that aren't waiting to be pushed, were deleted long enough ago that
   * their tombstones are gone. Drop them.
   */
  private async prune(seen: Set<string>): Promise<void> {
    const pending = new Set(await this.db.sync.pendingKeys())
    const gone = allKeys(this.store.entities).filter(
      (k) => k !== SETTINGS_KEY && !seen.has(k) && !pending.has(k),
    )
    if (gone.length === 0) return
    const stamp = this.store.tick()
    const { changes } = incomingChanges(
      this.store.entities,
      gone.map((key) => ({ key, deleted: stamp })),
    )
    this.store.applyRemote(changes, 'sync')
    await this.db.idle()
  }

  /** Push the outbox. Returns true if something conflicted (pull again). */
  private async push(): Promise<boolean> {
    const s = this.db.sync
    let conflicted = false
    for (;;) {
      const batch = await s.outbox(PUSH_BATCH)
      if (batch.length === 0) return conflicted
      const keys = batch.map((b) => b.key)
      const [ids, seqs] = await Promise.all([
        this.crypto.syncIds(keys),
        s.seqs(keys),
      ])
      const payloads: Payload[] = []
      for (const k of keys) {
        const v = lookup(this.store.entities, k)
        payloads.push(
          v === undefined
            ? { k, d: (await s.tombstone(k)) ?? this.store.tick() }
            : { k, v },
        )
      }
      const envs = await this.crypto.encrypt(
        payloads.map((p, i) => ({ recordId: aadId(ids[i]!), value: p })),
      )
      const { results } = await this.net.push(
        envs.map((e, i) => ({
          id: ids[i]!,
          baseSeq: seqs.get(keys[i]!) ?? 0,
          alg: e.alg,
          keyId: e.keyId,
          nonce: e.nonce,
          ciphertext: e.ciphertext,
          tombstone: payloads[i]!.v === undefined,
        })),
      )
      const byId = new Map(results.map((r) => [r.id, r]))
      const done = []
      const accepted = []
      let blocked: SyncBlockedError | null = null
      for (const [i, row] of batch.entries()) {
        const r = byId.get(ids[i]!)
        if (!r) continue
        if (r.error) blocked ??= new SyncBlockedError(r.error)
        else if (r.conflict) conflicted = true
        else {
          done.push(row)
          accepted.push({ key: row.key, seq: r.seq })
        }
      }
      await s.setSeqs(accepted)
      await s.clearOutbox(done)
      if (blocked) throw blocked
      if (conflicted) return true
    }
  }
}

function envelope(r: WireRecord): EnvelopeB64 {
  return {
    alg: r.alg,
    keyId: r.keyId,
    nonce: r.nonce,
    ciphertext: r.ciphertext,
  }
}

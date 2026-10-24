// When and where sync runs (PLAN.md §11.4). One tab per account leads (Web
// Locks) and talks to the server; every tab relays its changes to the
// others over a BroadcastChannel, so all tabs show the same thing.

import { create } from 'zustand'
import { ApiError } from '../account/api'
import type { EncryptedDB } from '../persistence/encrypted'
import type { Change } from '../store/draft'
import type { EntityStore } from '../store/store'
import {
  SyncBlockedError,
  SyncEngine,
  type SyncCrypto,
  type SyncTransport,
} from './engine'
import { incomingChanges, toIncoming } from './incoming'

export type SyncState =
  | { kind: 'starting' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'offline' }
  | { kind: 'blocked'; message: string }
  | { kind: 'error' }
  | { kind: 'other-tab' }
  | { kind: 'needs-sign-in' }

export const useSyncStatus = create<{ state: SyncState }>(() => ({
  state: { kind: 'starting' },
}))
const setState = (state: SyncState) => useSyncStatus.setState({ state })

let resumeFn: (() => void) | undefined

/** After a fresh server session, start syncing again (decision 35). */
export function resumeSync(): void {
  resumeFn?.()
}

const VISIBLE_POLL_MS = 15_000
const HIDDEN_POLL_MS = 60_000
const LOCAL_DEBOUNCE_MS = 1_000
const RETRY_MS = 30_000

interface Options {
  userId: string
  store: EntityStore
  db: EncryptedDB
  crypto: SyncCrypto
  net: SyncTransport
}

interface TabMessage {
  changes: Change[]
  /** The sender made these itself, so the leader should push them. */
  local: boolean
}

/** Start syncing; returns a function that stops everything. */
export function startSync(o: Options): () => void {
  const engine = new SyncEngine(o.store, o.db, o.crypto, o.net)
  let stopped = false
  let paused = false
  let leader = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let again = false
  const cleanups: (() => void)[] = []

  const schedule = (delay: number) => {
    if (!leader || stopped || paused) return
    clearTimeout(timer)
    timer = setTimeout(() => void run(), delay)
  }

  async function run(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await once()
      } while (again && !stopped)
    })()
    await running
    running = null
  }

  async function once(): Promise<void> {
    setState({ kind: 'syncing' })
    try {
      await engine.sync()
      setState({ kind: 'synced', at: Date.now() })
      schedulePoll()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session expired or revoked: keep the vault open (decision 35).
        paused = true
        clearTimeout(timer)
        setState({ kind: 'needs-sign-in' })
        return
      }
      if (err instanceof SyncBlockedError)
        setState({ kind: 'blocked', message: err.message })
      else if (err instanceof ApiError && err.status === 0)
        setState({ kind: 'offline' })
      else {
        console.error('sync failed', err)
        setState({ kind: 'error' })
      }
      schedule(RETRY_MS)
    }
  }

  /** Between syncs, ask the server cheaply whether anything changed. */
  async function poll(): Promise<void> {
    if (!leader || stopped || paused || running) return
    try {
      const head = await o.net.head()
      if (head.seq > (await engine.cursor())) await run()
      else schedulePoll()
    } catch {
      await run() // reports offline/401 properly
    }
  }

  const pollDelay = () =>
    document.visibilityState === 'visible' ? VISIBLE_POLL_MS : HIDDEN_POLL_MS

  // Polls share the timer, so a scheduled sync replaces a pending poll.
  const schedulePoll = () => {
    if (!leader || stopped || paused) return
    clearTimeout(timer)
    timer = setTimeout(() => void poll(), pollDelay())
  }
  // ---- Tabs ---------------------------------------------------------------
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(`dayrule-sync-${o.userId}`)
  if (channel) {
    channel.onmessage = (ev: MessageEvent<TabMessage>) => {
      const { changes } = incomingChanges(
        o.store.entities,
        ev.data.changes.map(toIncoming),
      )
      o.store.applyRemote(changes, 'tab')
      if (ev.data.local) schedule(LOCAL_DEBOUNCE_MS)
    }
    cleanups.push(() => channel.close())
  }
  cleanups.push(
    o.store.subscribeChanges((changes, { source }) => {
      if (source === 'tab') return
      // Tell other tabs once our copy is saved, so their leader finds the
      // outbox entry when it pushes.
      void o.db.idle().then(() =>
        channel?.postMessage({
          changes,
          local: source === 'local',
        } satisfies TabMessage),
      )
      if (source === 'local') schedule(LOCAL_DEBOUNCE_MS)
    }),
  )

  // ---- Triggers -------------------------------------------------------------
  const now = () => schedule(0)
  const onVisible = () => document.visibilityState === 'visible' && now()
  window.addEventListener('online', now)
  window.addEventListener('focus', now)
  document.addEventListener('visibilitychange', onVisible)
  cleanups.push(() => {
    window.removeEventListener('online', now)
    window.removeEventListener('focus', now)
    document.removeEventListener('visibilitychange', onVisible)
  })

  // ---- Leadership -----------------------------------------------------------
  const becomeLeader = () => {
    leader = true
    void run()
  }
  if (navigator.locks) {
    setState({ kind: 'other-tab' })
    const release = new AbortController()
    cleanups.push(() => release.abort())
    navigator.locks
      .request(`dayrule-sync-${o.userId}`, { signal: release.signal }, () => {
        if (stopped) return
        becomeLeader()
        // Hold the lock until this tab stops syncing or closes.
        return new Promise<void>((resolve) => cleanups.push(resolve))
      })
      .catch(() => undefined) // aborted
  } else {
    becomeLeader()
  }

  function resume() {
    if (stopped) return
    paused = false
    if (leader) schedule(0)
  }
  resumeFn = resume

  function stop() {
    if (stopped) return
    stopped = true
    leader = false
    paused = false
    clearTimeout(timer)
    if (resumeFn === resume) resumeFn = undefined
    for (const c of cleanups) c()
  }

  return stop
}

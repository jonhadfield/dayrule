import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../account/api'
import type { EncryptedDB } from '../persistence/encrypted'
import * as cmd from '../store/commands'
import { createEntityStore } from '../store/store'
import {
  resumeSync,
  startSync,
  useSyncStatus,
  type SyncState,
} from './controller'
import type { SyncCrypto, SyncTransport } from './engine'

const unauthorized = new ApiError(401, 'unauthorized', 'Sign in again')

let stops: (() => void)[] = []

beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  })
  useSyncStatus.setState({ state: { kind: 'starting' } })
})

afterEach(() => {
  for (const stop of stops) stop()
  stops = []
})

function transport(auth: { ok: boolean }): SyncTransport {
  const check = () => {
    if (!auth.ok) throw unauthorized
  }
  return {
    head: async () => (check(), { seq: 0, floor: 0 }),
    pull: async () => (check(), { records: [], cursor: 0, hasMore: false }),
    push: async () => (check(), { results: [], head: 0 }),
  }
}

function stubDb() {
  const state = new Map<string, unknown>()
  const pending = new Set<string>()
  return {
    idle: async () => {},
    sync: {
      getState: async (k: string) => state.get(k) as never,
      setState: async (k: string, v: unknown) => {
        state.set(k, v)
      },
      markDirty: async (keys: string[]) => {
        for (const k of keys) pending.add(k)
      },
      outbox: async () => [],
      pendingKeys: async () => [...pending],
      clearOutbox: async () => {},
      seqs: async () => new Map(),
      setSeqs: async () => {},
      allSeqKeys: async () => [],
      clearSeqs: async () => {},
      tombstone: async () => undefined,
    },
  } as unknown as EncryptedDB
}

const crypto: SyncCrypto = {
  syncIds: async (keys) => keys,
  encrypt: async () => [],
  decrypt: async () => [],
}

async function waitFor(kind: SyncState['kind']) {
  await vi.waitFor(() => {
    expect(useSyncStatus.getState().state.kind).toBe(kind)
  })
}

describe('startSync', () => {
  it('keeps the vault open on 401 and resumes after sign-in', async () => {
    const auth = { ok: false }
    const store = createEntityStore()
    const todo = store.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'Milk', placement: { list: 'inbox' } }),
    )
    const stop = startSync({
      userId: 'u',
      store,
      db: stubDb(),
      crypto,
      net: transport(auth),
    })
    stops.push(stop)

    await waitFor('needs-sign-in')
    expect(store.entities.todos[todo.id]?.title).toBe('Milk')

    auth.ok = true
    resumeSync()
    await waitFor('synced')
    expect(store.entities.todos[todo.id]?.title).toBe('Milk')
  })
})

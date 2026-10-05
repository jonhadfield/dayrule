// The app's entity store: plaintext, in memory only (PLAN.md §9), with an
// undo/redo stack of recorded changes.

import { v7 as uuidv7 } from 'uuid'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { toLocalDate } from '../domain/dates'
import { emptyEntities, type Entities } from '../domain/types'
import type { Env } from './commands'
import { Hlc, newDeviceId } from '../domain/hlc'
import { withRepairs } from '../domain/repair'
import type { FieldClock } from '../domain/merge'
import {
  applyChanges,
  Draft,
  type Change,
  type Collection,
  type EntityOf,
} from './draft'

const UNDO_LIMIT = 200

export interface Entry {
  label: string
  changes: Change[]
}

export interface StoreState {
  entities: Entities
  past: Entry[]
  future: Entry[]
}

/**
 * Where a change came from: made here, merged in by sync, or relayed from
 * another tab (which has already saved it).
 */
export type ChangeSource = 'local' | 'sync' | 'tab'

export type ChangeListener = (
  changes: Change[],
  meta: { source: ChangeSource },
) => void

export interface Clock {
  now: () => Date
  newId: () => string
  hlc: Hlc
}

const systemClock = (): Clock => ({
  now: () => new Date(),
  newId: () => uuidv7(),
  hlc: new Hlc(newDeviceId()),
})

/** The clock of generated records: older than any real write. */
export const GENERATED = '000000000-0000-generated'

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * Stamp each changed field with a fresh HLC tick, relative to the current
 * state. Done for commands, undo and redo alike, so an undo is a new write
 * that syncs, not an old one that loses.
 */
function stamp(current: Entities, changes: Change[], tick: string): Change[] {
  const restamp = <T extends { clock?: FieldClock }>(
    before: T | undefined,
    after: T,
  ): T => {
    const clock: FieldClock = { ...(before?.clock ?? {}) }
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
    for (const k of keys) {
      if (k === 'clock') continue
      const b = (before as Record<string, unknown> | undefined)?.[k]
      const a = (after as Record<string, unknown>)[k]
      if (!before || !sameValue(a, b)) clock[k] = tick
    }
    return { ...after, clock }
  }
  return changes.map((c): Change => {
    if (c.kind === 'settings') {
      return {
        ...c,
        before: current.settings,
        after: restamp(current.settings, c.after),
        hlc: tick,
      }
    }
    const cur = current[c.collection][c.id] as EntityOf<Collection> | undefined
    return {
      ...c,
      before: cur,
      after: c.after
        ? (restamp(cur, c.after) as EntityOf<Collection>)
        : undefined,
      hlc: tick,
    }
  })
}

export function createEntityStore(
  initial = emptyEntities(),
  clock: Clock = systemClock(),
) {
  const store = createStore<StoreState>(() => ({
    entities: initial,
    past: [],
    future: [],
  }))
  const listeners = new Set<ChangeListener>()
  const emit = (changes: Change[], source: ChangeSource = 'local') => {
    for (const l of listeners) l(changes, { source })
  }

  function env(): Env {
    const now = clock.now()
    return { now, today: toLocalDate(now), newId: clock.newId }
  }

  return {
    store,

    get entities(): Entities {
      return store.getState().entities
    },

    /** Run a command; records it for undo unless it changed nothing. */
    run<R>(
      label: string | ((result: NoInfer<R>) => string),
      command: (d: Draft, env: Env) => R,
    ): R {
      const { entities, past } = store.getState()
      const draft = new Draft(entities)
      const result = command(draft, env())
      const proposed = draft.changes()
      if (proposed.length === 0) return result
      const changes = stamp(entities, proposed, clock.hlc.tick())

      store.setState({
        entities: applyChanges(entities, changes, 'forward'),
        past: [
          ...past,
          {
            label: typeof label === 'function' ? label(result) : label,
            changes,
          },
        ].slice(-UNDO_LIMIT),
        future: [],
      })
      emit(changes)
      return result
    },

    undo(): string | undefined {
      const { entities, past, future } = store.getState()
      const entry = past[past.length - 1]
      if (!entry) return undefined
      const changes = stamp(
        entities,
        rebase(entities, invert(entry.changes)),
        clock.hlc.tick(),
      )
      store.setState({
        entities: applyChanges(entities, changes, 'forward'),
        past: past.slice(0, -1),
        future: [...future, entry],
      })
      emit(changes)
      return entry.label
    },

    /**
     * Take back the latest steps while each passes `ours`, down to and
     * including the one `first` matches (an empty new to-do being thrown
     * away, with the edits made to it). Unlike undo, they can't be redone.
     * Does nothing and returns false if `first` isn't reached that way.
     */
    retract(
      ours: (e: Entry) => boolean,
      first: (e: Entry) => boolean,
    ): boolean {
      const { past } = store.getState()
      let n = 0
      for (let i = past.length - 1; i >= 0; i--) {
        const entry = past[i]!
        if (!ours(entry)) return false
        n++
        if (first(entry)) break
        if (i === 0) return false
      }
      if (n === 0) return false
      for (let k = 0; k < n; k++) {
        const { entities, past: now } = store.getState()
        const entry = now[now.length - 1]!
        const changes = stamp(
          entities,
          rebase(entities, invert(entry.changes)),
          clock.hlc.tick(),
        )
        store.setState({
          entities: applyChanges(entities, changes, 'forward'),
          past: now.slice(0, -1),
        })
        emit(changes)
      }
      return true
    },

    redo(): string | undefined {
      const { entities, past, future } = store.getState()
      const entry = future[future.length - 1]
      if (!entry) return undefined
      const changes = stamp(
        entities,
        rebase(entities, entry.changes),
        clock.hlc.tick(),
      )
      store.setState({
        entities: applyChanges(entities, changes, 'forward'),
        past: [...past, entry],
        future: future.slice(0, -1),
      })
      emit(changes)
      return entry.label
    },

    /**
     * Run upkeep that isn't a user action (creating repeating to-dos'
     * instances): no undo entry, saved and synced like local changes. The
     * records the command reports creating are stamped with GENERATED, the
     * lowest possible clock, so devices that make the same record agree,
     * and any real edit, completion or deletion beats it.
     */
    generate(command: (d: Draft, env: Env) => Set<string>): void {
      const { entities } = store.getState()
      const draft = new Draft(entities)
      const created = command(draft, env())
      const proposed = draft.changes()
      if (proposed.length === 0) return
      const changes = stamp(entities, proposed, clock.hlc.tick()).map((c) => {
        if (
          c.kind !== 'entity' ||
          !c.after ||
          !created.has(`${c.collection}/${c.id}`)
        )
          return c
        const fixed = Object.fromEntries(
          Object.keys(c.after.clock ?? {}).map((k) => [k, GENERATED]),
        )
        return {
          ...c,
          after: { ...c.after, clock: fixed } as typeof c.after,
          hlc: GENERATED,
        }
      })
      store.setState((st) => ({
        entities: applyChanges(st.entities, changes, 'forward'),
      }))
      emit(changes)
    },

    /**
     * Apply already-merged changes from sync or another tab: no undo entry
     * and no re-stamping. Our clock moves past their stamps.
     */
    applyRemote(
      changes: Change[],
      source: Exclude<ChangeSource, 'local'>,
    ): void {
      if (changes.length === 0) return
      for (const c of changes) {
        for (const s of Object.values(c.after?.clock ?? {})) {
          clock.hlc.observe(s)
        }
        if (c.hlc) clock.hlc.observe(c.hlc)
      }
      store.setState((s) => ({
        entities: applyChanges(s.entities, changes, 'forward'),
      }))
      emit(changes, source)
    },

    /** The store's clock, so sync can stamp tombstones it creates. */
    tick(): string {
      return clock.hlc.tick()
    },

    /** Replace everything without recording undo, e.g. after loading. */
    hydrate(entities: Entities): void {
      store.setState({ entities, past: [], future: [] })
    },

    /** Be told about every applied change, e.g. to persist it. */
    subscribeChanges(listener: ChangeListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Replay an undo/redo step onto the current state: only the fields the step
 * changed are written, so edits to other fields that arrived since (from
 * another device) survive.
 */
function rebase(current: Entities, changes: Change[]): Change[] {
  const onto = <T extends object>(cur: T, from: T | undefined, to: T): T => {
    const out = { ...cur } as unknown as Record<string, unknown>
    const f = (from ?? {}) as unknown as Record<string, unknown>
    const t = to as unknown as Record<string, unknown>
    for (const k of new Set([...Object.keys(f), ...Object.keys(t)])) {
      if (k === 'clock' || sameValue(f[k], t[k])) continue
      if (t[k] === undefined) delete out[k]
      else out[k] = t[k]
    }
    return out as unknown as T
  }
  return changes.map((c): Change => {
    if (c.kind === 'settings') {
      return { ...c, after: onto(current.settings, c.before, c.after) }
    }
    const cur = current[c.collection][c.id]
    if (!cur || !c.after || !c.before) return c
    return { ...c, after: onto(cur, c.before, c.after) }
  })
}

function invert(changes: Change[]): Change[] {
  return [...changes]
    .reverse()
    .map((c) =>
      c.kind === 'settings'
        ? { kind: 'settings', before: c.after, after: c.before }
        : { ...c, before: c.after, after: c.before },
    )
}

export type EntityStore = ReturnType<typeof createEntityStore>

export function useEntities<T>(s: EntityStore, select: (e: Entities) => T): T {
  return useStore(s.store, (state) => select(withRepairs(state.entities)))
}

export function useUndoState(s: EntityStore) {
  const canUndo = useStore(s.store, (state) => state.past.length > 0)
  const canRedo = useStore(s.store, (state) => state.future.length > 0)
  return { canUndo, canRedo }
}

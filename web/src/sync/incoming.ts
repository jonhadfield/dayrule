// Turning records from another device or tab into store changes
// (PLAN.md §11.2). Pure: the caller applies the changes and pushes back the
// keys where this device knows something newer.

import { latestStamp, mergeEntity, resolveTombstone } from '../domain/merge'
import type { Entities, Settings } from '../domain/types'
import type { Change, Collection, EntityOf } from '../store/draft'
import { COLLECTIONS, SETTINGS_KEY } from '../persistence/encrypted'

/** A record's latest state: a value, or a deletion at an HLC stamp. */
export interface Incoming {
  key: string
  value?: unknown
  deleted?: string
}

/** Order-insensitive deep equality for JSON values. */
export function sameJSON(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  )
  const kb = Object.keys(b).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  )
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    sameJSON(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  )
}

export function parseKey(
  key: string,
): { collection: Collection; id: string } | null {
  const slash = key.indexOf('/')
  const collection = key.slice(0, slash) as Collection
  if (slash < 1 || !COLLECTIONS.includes(collection)) return null
  return { collection, id: key.slice(slash + 1) }
}

/** The current value for a record key, if it exists. */
export function lookup(e: Entities, key: string): unknown {
  if (key === SETTINGS_KEY) return e.settings
  const k = parseKey(key)
  return k ? e[k.collection][k.id] : undefined
}

/** Every record key that currently exists. */
export function allKeys(e: Entities): string[] {
  const keys = [SETTINGS_KEY]
  for (const c of COLLECTIONS)
    for (const id of Object.keys(e[c])) keys.push(`${c}/${id}`)
  return keys
}

/** What other tabs and devices need to know about a store change. */
export function toIncoming(c: Change): Incoming {
  if (c.kind === 'settings') return { key: SETTINGS_KEY, value: c.after }
  const key = `${c.collection}/${c.id}`
  return c.after ? { key, value: c.after } : { key, deleted: c.hlc ?? '' }
}

export function incomingChanges(
  entities: Entities,
  items: readonly Incoming[],
  localTombstones: ReadonlyMap<string, string> = new Map(),
): { changes: Change[]; pushBack: string[] } {
  const changes: Change[] = []
  const pushBack = new Set<string>()
  // Later items for the same key see earlier ones.
  const seen = new Map<string, unknown>()
  const current = (key: string) =>
    seen.has(key) ? seen.get(key) : lookup(entities, key)

  for (const item of items) {
    if (item.key === SETTINGS_KEY) {
      if (item.value === undefined) continue
      const local = current(item.key) as Settings
      const merged = mergeEntity(local, item.value as Settings)
      if (!sameJSON(merged, local))
        changes.push({ kind: 'settings', before: local, after: merged })
      if (!sameJSON(merged, item.value)) pushBack.add(item.key)
      seen.set(item.key, merged)
      continue
    }
    const k = parseKey(item.key)
    if (!k) continue
    const local = current(item.key) as EntityOf<Collection> | undefined

    if (item.deleted !== undefined) {
      if (!local) continue
      const r = resolveTombstone(local, item.deleted)
      if (r.kind === 'keep') {
        pushBack.add(item.key) // edited after the deletion: revive it everywhere
        continue
      }
      changes.push({
        kind: 'entity',
        ...k,
        before: local,
        after: undefined,
        hlc: item.deleted,
      })
      seen.set(item.key, undefined)
      continue
    }

    const value = item.value as EntityOf<Collection>
    const tomb = localTombstones.get(item.key)
    if (!local && tomb !== undefined && tomb >= latestStamp(value)) {
      pushBack.add(item.key) // deleted here after that version was written
      continue
    }
    const merged = mergeEntity(local, value)
    if (!sameJSON(merged, local))
      changes.push({ kind: 'entity', ...k, before: local, after: merged })
    if (!sameJSON(merged, value)) pushBack.add(item.key)
    seen.set(item.key, merged)
  }
  return { changes, pushBack: [...pushBack] }
}

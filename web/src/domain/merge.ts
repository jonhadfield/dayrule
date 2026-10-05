// Field-level last-writer-wins merge (PLAN.md §11.2). Every entity carries
// `clock`: field name → HLC stamp of its last write. Merging takes each
// field from whichever side wrote it last, so all devices converge to the
// same state whatever order changes arrive in.

import type { HlcStamp } from './hlc'

export type FieldClock = Record<string, HlcStamp>

export interface Clocked {
  clock?: FieldClock
}

const META = new Set(['clock'])

/** The newest stamp on an entity (for comparing with a tombstone). */
export function latestStamp(e: Clocked | undefined): HlcStamp {
  let max = ''
  for (const s of Object.values(e?.clock ?? {})) if (s > max) max = s
  return max
}

/** Merge two versions of the same entity. Both may be partial in time. */
export function mergeEntity<T extends Clocked>(
  local: T | undefined,
  remote: T,
): T {
  if (!local) return remote
  const lc = local.clock ?? {}
  const rc = remote.clock ?? {}
  const out: Record<string, unknown> = {}
  const clock: FieldClock = {}
  const keys = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(lc),
    ...Object.keys(rc),
  ])
  for (const k of keys) {
    if (META.has(k)) continue
    const l = lc[k] ?? ''
    const r = rc[k] ?? ''
    // Newest write wins; on an exact tie (same stamp) remote and local are
    // the same write, so either is fine.
    const fromRemote = r > l
    const src = (fromRemote ? remote : local) as Record<string, unknown>
    if (src[k] !== undefined) out[k] = src[k]
    const stamp = fromRemote ? r : l
    if (stamp) clock[k] = stamp
  }
  out.clock = clock
  return out as T
}

export type Resolution<T> = { kind: 'keep'; value: T } | { kind: 'delete' }

/**
 * An entity against a tombstone: the deletion wins unless some field was
 * written after it (an edit made after the delete, elsewhere, revives it).
 */
export function resolveTombstone<T extends Clocked>(
  entity: T | undefined,
  tombstone: HlcStamp,
): Resolution<T> {
  if (!entity) return { kind: 'delete' }
  return latestStamp(entity) > tombstone
    ? { kind: 'keep', value: entity }
    : { kind: 'delete' }
}

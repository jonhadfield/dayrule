// What the UI shows when records point at something deleted on another
// device (PLAN.md §11.2). Sync merges records one by one, so a to-do can
// arrive pointing at a project whose deletion arrived first, or vice versa.
//
// This is a view, not a write: writing repairs back would race the rest of
// a deletion still in flight (a "repaired" to-do would outlive its own
// tombstone). If the missing record comes back, its references work again.

import type { Entities, ID } from './types'

const cache = new WeakMap<Entities, Entities>()

/** Entities with dangling references dropped; the same object if none. */
export function withRepairs(e: Entities): Entities {
  let out = cache.get(e)
  if (!out) {
    out = repair(e)
    cache.set(e, out)
  }
  return out
}

function repair(e: Entities): Entities {
  const has = <T>(m: Record<ID, T>, id: ID | undefined) =>
    id === undefined || m[id] !== undefined
  const liveTags = (ids: ID[]) =>
    ids.every((id) => e.tags[id]) ? ids : ids.filter((id) => e.tags[id])
  let next: Entities | null = null
  const edit = <
    C extends
      'areas' | 'projects' | 'headings' | 'todos' | 'checklistItems' | 'tags',
  >(
    c: C,
    id: ID,
    value: Entities[C][ID] | undefined,
  ) => {
    next ??= { ...e }
    if (next[c] === e[c]) next[c] = { ...e[c] } as Entities[C]
    const m = next[c] as Record<ID, unknown>
    if (value === undefined) delete m[id]
    else m[id] = value
  }

  for (const a of Object.values(e.areas)) {
    const tagIds = liveTags(a.tagIds)
    if (tagIds !== a.tagIds) edit('areas', a.id, { ...a, tagIds })
  }
  for (const p of Object.values(e.projects)) {
    const tagIds = liveTags(p.tagIds)
    const areaOk = has(e.areas, p.areaId)
    if (tagIds !== p.tagIds || !areaOk) {
      edit('projects', p.id, {
        ...p,
        tagIds,
        ...(areaOk ? {} : { areaId: undefined }),
      })
    }
  }
  for (const h of Object.values(e.headings)) {
    if (!has(e.projects, h.projectId)) edit('headings', h.id, undefined)
  }
  for (const t of Object.values(e.todos)) {
    const projectOk = has(e.projects, t.projectId)
    const heading =
      t.headingId === undefined ? undefined : e.headings[t.headingId]
    const headingOk =
      t.headingId === undefined ||
      (projectOk && heading !== undefined && heading.projectId === t.projectId)
    const areaOk = has(e.areas, t.areaId)
    const tagIds = liveTags(t.tagIds)
    if (projectOk && headingOk && areaOk && tagIds === t.tagIds) continue
    const fixed = { ...t, tagIds }
    if (!projectOk) {
      delete fixed.projectId
      // It lost its home: put it where it will be noticed and filed again.
      if (fixed.start === 'ready' && !fixed.startDate) fixed.start = 'inbox'
    }
    if (!headingOk) delete fixed.headingId
    if (!areaOk) delete fixed.areaId
    edit('todos', t.id, fixed)
  }
  for (const c of Object.values(e.checklistItems)) {
    if (!has(e.todos, c.todoId)) edit('checklistItems', c.id, undefined)
  }
  for (const t of Object.values(e.tags)) {
    if (!has(e.tags, t.parentId))
      edit('tags', t.id, { ...t, parentId: undefined })
  }
  return next ?? e
}

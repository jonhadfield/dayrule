// Quick Find (PLAN.md §7): search runs in the browser, since the server
// holds only ciphertext. The index is built from the current entities
// when Find opens, so it is always up to date and costs nothing otherwise.

import MiniSearch from 'minisearch'
import {
  effectiveStart,
  isInDone,
  isTrashed,
  projectOf,
  type ListContext,
} from './lists'
import type { Entities, Todo } from './types'

export type FindKind = 'list' | 'project' | 'area' | 'todo'

export interface FindResult {
  id: string
  kind: FindKind
  title: string
  /** Where it lives, shown under the title. */
  detail: string
  /** The route that shows it. */
  path: string
  /** For to-dos: open it once there. */
  todoId?: string
}

interface Doc extends FindResult {
  text: string
  notes: string
  tags: string
}

const LISTS: { title: string; path: string }[] = [
  { title: 'Inbox', path: '/inbox' },
  { title: 'Today', path: '/today' },
  { title: 'Scheduled', path: '/scheduled' },
  { title: 'Backlog', path: '/backlog' },
  { title: 'Done', path: '/done' },
  { title: 'Trash', path: '/trash' },
]

/** The list a to-do shows up in, for jumping to it. */
export function homeOf(
  e: Entities,
  t: Todo,
  ctx: ListContext,
): { path: string; label: string } {
  if (isTrashed(e, t)) return { path: '/trash', label: 'Trash' }
  if (t.repeat) return { path: '/scheduled', label: 'Repeating' }
  if (isInDone(e, t, ctx)) return { path: '/done', label: 'Done' }
  const project = projectOf(e, t)
  if (project)
    return {
      path: `/project/${project.id}`,
      label: project.title || 'Untitled project',
    }
  const area = t.areaId ? e.areas[t.areaId] : undefined
  if (area)
    return { path: `/area/${area.id}`, label: area.title || 'Untitled area' }
  const start = effectiveStart(e, t)
  if (start === 'inbox') return { path: '/inbox', label: 'Inbox' }
  if (start === 'later') return { path: '/backlog', label: 'Not now' }
  const due =
    (t.startDate !== undefined && t.startDate <= ctx.today) ||
    (t.deadline !== undefined && t.deadline <= ctx.today)
  if (due) return { path: '/today', label: 'Today' }
  if (t.startDate !== undefined)
    return { path: '/scheduled', label: 'Scheduled' }
  return { path: '/backlog', label: 'Backlog' }
}

export interface Finder {
  search(query: string): FindResult[]
}

export function buildFinder(e: Entities, ctx: ListContext): Finder {
  const docs: Doc[] = []
  for (const l of LISTS) {
    docs.push({
      id: `list:${l.path}`,
      kind: 'list',
      title: l.title,
      detail: 'List',
      path: l.path,
      text: l.title,
      notes: '',
      tags: '',
    })
  }
  for (const a of Object.values(e.areas)) {
    if (a.trashedAt) continue
    docs.push({
      id: `area:${a.id}`,
      kind: 'area',
      title: a.title || 'Untitled area',
      detail: 'Area',
      path: `/area/${a.id}`,
      text: a.title,
      notes: '',
      tags: '',
    })
  }
  for (const p of Object.values(e.projects)) {
    if (isTrashed(e, p)) continue
    const area = p.areaId ? e.areas[p.areaId] : undefined
    docs.push({
      id: `project:${p.id}`,
      kind: 'project',
      title: p.title || 'Untitled project',
      detail: area ? `Project in ${area.title || 'Untitled area'}` : 'Project',
      path: `/project/${p.id}`,
      text: p.title,
      notes: p.notes ?? '',
      tags: p.tagIds.map((id) => e.tags[id]?.title ?? '').join(' '),
    })
  }
  for (const t of Object.values(e.todos)) {
    const home = homeOf(e, t, ctx)
    docs.push({
      id: `todo:${t.id}`,
      kind: 'todo',
      title: t.title || 'Untitled',
      detail: home.label,
      path: home.path,
      todoId: t.id,
      text: t.title,
      notes: t.notes,
      tags: t.tagIds.map((id) => e.tags[id]?.title ?? '').join(' '),
    })
  }

  const index = new MiniSearch<Doc>({
    fields: ['text', 'notes', 'tags'],
    storeFields: ['id'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { text: 3, tags: 1.5 },
      combineWith: 'AND',
    },
  })
  index.addAll(docs)
  const byId = new Map(docs.map((d) => [d.id, d]))
  // Lists, areas and projects before to-dos when relevance is close.
  const kindBoost: Record<FindKind, number> = {
    list: 1.6,
    area: 1.3,
    project: 1.3,
    todo: 1,
  }

  return {
    search(query) {
      const q = query.trim()
      if (!q) return []
      return index
        .search(q, {
          boostDocument: (id) => kindBoost[byId.get(String(id))!.kind],
        })
        .slice(0, 30)
        .map((r) => {
          const {
            text: _t,
            notes: _n,
            tags: _g,
            ...result
          } = byId.get(String(r.id))!
          return result
        })
    },
  }
}

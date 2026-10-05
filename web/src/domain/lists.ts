// List rules (PLAN.md §4.1) as pure selectors over the entity store.

import { addLocalDays, toLocalDate } from './dates'
import { compareKeys } from './order'
import type {
  Area,
  Entities,
  Heading,
  ID,
  LocalDate,
  Project,
  Todo,
} from './types'

export interface ListContext {
  /** Local date the lists are computed for. */
  today: LocalDate
  /**
   * Just-completed items kept in their list for a moment, so the
   * completion can be seen (and undone) before they move to Done.
   */
  keepVisible?: ReadonlySet<string>
}

export type Item = Todo | Project

// ---------------------------------------------------------------------------
// Effective state: a to-do inherits trash and "Not now" from its project.

export function projectOf(e: Entities, t: Todo): Project | undefined {
  return t.projectId ? e.projects[t.projectId] : undefined
}

function areaTrashed(e: Entities, areaId: ID | undefined): boolean {
  return areaId !== undefined && e.areas[areaId]?.trashedAt !== undefined
}

export function isTrashed(e: Entities, item: Item): boolean {
  if (item.trashedAt) return true
  if (item.type === 'project') return areaTrashed(e, item.areaId)
  const project = projectOf(e, item)
  if (project) return isTrashed(e, project)
  return areaTrashed(e, item.areaId)
}

function localDateOf(ts: string): LocalDate {
  return toLocalDate(new Date(ts))
}

/**
 * A completed or canceled item stays visible (struck through) in its list
 * until it is logged, then it moves to Done.
 */
export function isInDone(e: Entities, item: Item, ctx: ListContext): boolean {
  if (item.status === 'open' || !item.completedAt) return false
  if (ctx.keepVisible?.has(item.id)) return false
  switch (e.settings.moveToDone) {
    case 'immediately':
      return true
    case 'daily':
      return localDateOf(item.completedAt) < ctx.today
    case 'manually': {
      const at = e.settings.lastMovedToDoneAt
      return at !== undefined && item.completedAt <= at
    }
  }
}

/** A repeating to-do's template: shown only in Scheduled (§4.2). */
export function isTemplate(item: Item): boolean {
  return item.type === 'todo' && item.repeat !== undefined
}

/** In a list at all: not trashed, not logged, and its project still open. */
export function isVisible(e: Entities, item: Item, ctx: ListContext): boolean {
  if (isTemplate(item) || isTrashed(e, item) || isInDone(e, item, ctx))
    return false
  if (item.type === 'todo') {
    const project = projectOf(e, item)
    if (project && project.status !== 'open' && isInDone(e, project, ctx)) {
      return false
    }
  }
  return true
}

export function effectiveStart(e: Entities, item: Item): Todo['start'] {
  if (item.type === 'todo') {
    const project = projectOf(e, item)
    if (project?.start === 'later') return 'later'
    // To-dos inside a project or area are never in the Inbox.
    if (item.start === 'inbox' && (item.projectId || item.areaId)) {
      return 'ready'
    }
  }
  return item.start
}

function byOrder(a: Item, b: Item): number {
  return compareKeys(a.order, b.order) || compareKeys(a.id, b.id)
}

function byTodayOrder(a: Item, b: Item): number {
  return (
    compareKeys(a.todayOrder ?? a.order, b.todayOrder ?? b.order) ||
    compareKeys(a.id, b.id)
  )
}

function items(e: Entities): Item[] {
  return [...Object.values(e.todos), ...Object.values(e.projects)]
}

// ---------------------------------------------------------------------------
// Lists

export function inbox(e: Entities, ctx: ListContext): Todo[] {
  return Object.values(e.todos)
    .filter((t) => isVisible(e, t, ctx) && effectiveStart(e, t) === 'inbox')
    .sort(byOrder)
}

function isDueToday(item: Item, ctx: ListContext): boolean {
  return (
    (item.startDate !== undefined && item.startDate <= ctx.today) ||
    (item.deadline !== undefined && item.deadline <= ctx.today)
  )
}

/** Today: everything started today or earlier, or due today. */
export function today(e: Entities, ctx: ListContext): Item[] {
  return items(e)
    .filter(
      (i) =>
        isVisible(e, i, ctx) &&
        effectiveStart(e, i) !== 'later' &&
        isDueToday(i, ctx),
    )
    .sort(byTodayOrder)
}

export function isOverdue(item: Item, ctx: ListContext): boolean {
  return (
    item.status === 'open' &&
    item.deadline !== undefined &&
    item.deadline < ctx.today
  )
}

export interface ScheduledList {
  /** The next 7 days after today, always present even when empty. */
  days: { date: LocalDate; items: Item[] }[]
  /** Later items grouped by month (`YYYY-MM`), only months with items. */
  months: { month: string; items: Item[] }[]
  /** "After completion" repeats waiting for their current one to be done. */
  waiting: Item[]
}

/** The date an item shows under in Scheduled; templates use their next one. */
export function scheduledDate(i: Item): LocalDate | undefined {
  return i.type === 'todo' && i.repeat ? i.repeat.next : i.startDate
}

export function scheduled(e: Entities, ctx: ListContext): ScheduledList {
  const dated = (i: Item) => {
    const date = scheduledDate(i)
    return date !== undefined && date > ctx.today
  }
  const scheduled = items(e)
    .filter(
      (i) =>
        i.status === 'open' &&
        effectiveStart(e, i) !== 'later' &&
        dated(i) &&
        // Templates appear here as their next occurrence.
        (isTemplate(i) ? !isTrashed(e, i) : isVisible(e, i, ctx)),
    )
    .sort(
      (a, b) =>
        compareKeys(scheduledDate(a) ?? '', scheduledDate(b) ?? '') ||
        byOrder(a, b),
    )

  const days = Array.from({ length: 7 }, (_, n) => {
    const date = addLocalDays(ctx.today, n + 1)
    return { date, items: scheduled.filter((i) => scheduledDate(i) === date) }
  })
  const lastDay = days[days.length - 1]?.date ?? ctx.today

  const months: ScheduledList['months'] = []
  for (const i of scheduled) {
    if ((scheduledDate(i) ?? '') <= lastDay) continue
    const month = (scheduledDate(i) ?? '').slice(0, 7)
    const group = months[months.length - 1]
    if (group?.month === month) group.items.push(i)
    else months.push({ month, items: [i] })
  }

  const waiting = Object.values(e.todos)
    .filter((t) => t.repeat && !t.repeat.next && !isTrashed(e, t))
    .sort(byOrder)

  return { days, months, waiting }
}

export type Container =
  | { kind: 'none' }
  | { kind: 'area'; area: Area }
  | { kind: 'project'; project: Project }

export interface Group {
  container: Container
  todos: Todo[]
}

function isAvailable(e: Entities, t: Todo, ctx: ListContext): boolean {
  return (
    isVisible(e, t, ctx) &&
    effectiveStart(e, t) === 'ready' &&
    (t.startDate === undefined || t.startDate <= ctx.today)
  )
}

/**
 * Backlog: everything that could be done any time, grouped by where it
 * lives. Stored as `start: 'ready'` (the data keeps its original values).
 */
export function backlog(e: Entities, ctx: ListContext): Group[] {
  const groups = new Map<string, Group>()
  const groupFor = (t: Todo): Group => {
    const project = projectOf(e, t)
    const area = t.areaId ? e.areas[t.areaId] : undefined
    const key = project ? `p:${project.id}` : area ? `a:${area.id}` : 'none'
    let g = groups.get(key)
    if (!g) {
      const container: Container = project
        ? { kind: 'project', project }
        : area
          ? { kind: 'area', area }
          : { kind: 'none' }
      g = { container, todos: [] }
      groups.set(key, g)
    }
    return g
  }

  for (const t of Object.values(e.todos)) {
    if (!isAvailable(e, t, ctx)) continue
    const project = projectOf(e, t)
    if (project && project.status !== 'open') continue
    groupFor(t).todos.push(t)
  }

  const rank = (g: Group): [number, string, string] => {
    const c = g.container
    if (c.kind === 'none') return [0, '', '']
    if (c.kind === 'area') return [1, c.area.order, '']
    const area = c.project.areaId ? e.areas[c.project.areaId] : undefined
    return [area ? 1 : 2, area?.order ?? '', c.project.order]
  }

  return [...groups.values()]
    .map((g) => ({ ...g, todos: g.todos.sort(byOrder) }))
    .sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)]
      return (
        ra[0] - rb[0] || compareKeys(ra[1], rb[1]) || compareKeys(ra[2], rb[2])
      )
    })
}

export interface NotNowList {
  projects: Project[]
  todos: Todo[]
}

/**
 * Backlog's "Not now" section: put aside for the moment. Stored as
 * `start: 'later'`.
 */
export function notNow(e: Entities, ctx: ListContext): NotNowList {
  return {
    projects: Object.values(e.projects)
      .filter((p) => isVisible(e, p, ctx) && p.start === 'later')
      .sort(byOrder),
    todos: Object.values(e.todos)
      .filter(
        (t) =>
          isVisible(e, t, ctx) &&
          t.start === 'later' &&
          projectOf(e, t)?.start !== 'later',
      )
      .sort(byOrder),
  }
}

export interface DoneDay {
  date: LocalDate
  items: Item[]
}

/** Logged items, newest first, grouped by the local day they were closed. */
export function doneList(e: Entities, ctx: ListContext): DoneDay[] {
  const logged = items(e)
    .filter((i) => !isTrashed(e, i) && isInDone(e, i, ctx))
    .sort((a, b) => compareKeys(b.completedAt ?? '', a.completedAt ?? ''))

  const days: DoneDay[] = []
  for (const i of logged) {
    const date = localDateOf(i.completedAt ?? '')
    const group = days[days.length - 1]
    if (group?.date === date) group.items.push(i)
    else days.push({ date, items: [i] })
  }
  return days
}

export interface TrashList {
  areas: Area[]
  items: Item[]
}

/** Items trashed directly (not those trashed only via their container). */
export function trash(e: Entities): TrashList {
  const newestFirst = (a: { trashedAt?: string }, b: { trashedAt?: string }) =>
    compareKeys(b.trashedAt ?? '', a.trashedAt ?? '')
  return {
    areas: Object.values(e.areas)
      .filter((a) => a.trashedAt)
      .sort(newestFirst),
    items: items(e)
      .filter((i) => i.trashedAt)
      .sort(newestFirst),
  }
}

export interface ProjectView {
  project: Project
  todos: Todo[]
  headings: { heading: Heading; todos: Todo[] }[]
}

export function projectView(
  e: Entities,
  projectId: ID,
  ctx: ListContext,
): ProjectView | undefined {
  const project = e.projects[projectId]
  if (!project) return undefined

  const todos = Object.values(e.todos)
    .filter(
      (t) =>
        t.projectId === projectId && !isTrashed(e, t) && !isInDone(e, t, ctx),
    )
    .sort(byOrder)
  const headings = Object.values(e.headings)
    .filter((h) => h.projectId === projectId && !h.archived)
    .sort((a, b) => compareKeys(a.order, b.order))

  const headingIds = new Set(headings.map((h) => h.id))
  return {
    project,
    todos: todos.filter((t) => !t.headingId || !headingIds.has(t.headingId)),
    headings: headings.map((heading) => ({
      heading,
      todos: todos.filter((t) => t.headingId === heading.id),
    })),
  }
}

export interface AreaView {
  area: Area
  projects: Project[]
  todos: Todo[]
}

export function areaView(
  e: Entities,
  areaId: ID,
  ctx: ListContext,
): AreaView | undefined {
  const area = e.areas[areaId]
  if (!area) return undefined
  return {
    area,
    projects: Object.values(e.projects)
      .filter((p) => p.areaId === areaId && isVisible(e, p, ctx))
      .sort(byOrder),
    todos: Object.values(e.todos)
      .filter(
        (t) =>
          t.areaId === areaId &&
          !t.projectId &&
          isVisible(e, t, ctx) &&
          effectiveStart(e, t) !== 'later',
      )
      .sort(byOrder),
  }
}

// ---------------------------------------------------------------------------
// Tags and counts

/** A tag and all its descendants. */
export function tagWithDescendants(e: Entities, tagId: ID): Set<ID> {
  const out = new Set<ID>([tagId])
  let added = true
  while (added) {
    added = false
    for (const t of Object.values(e.tags)) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id)
        added = true
      }
    }
  }
  return out
}

/** Tags on an item, including those inherited from its project and area. */
export function effectiveTagIds(e: Entities, item: Item): Set<ID> {
  const ids = new Set(item.tagIds)
  const project = item.type === 'todo' ? projectOf(e, item) : undefined
  for (const id of project?.tagIds ?? []) ids.add(id)
  const areaId = item.areaId ?? project?.areaId
  for (const id of (areaId ? e.areas[areaId]?.tagIds : undefined) ?? []) {
    ids.add(id)
  }
  return ids
}

/** Keep items that carry the tag (or a child of it). */
export function filterByTag<T extends Item>(
  e: Entities,
  list: T[],
  tagId: ID | null,
): T[] {
  if (tagId === null) return list
  const wanted = tagWithDescendants(e, tagId)
  return list.filter((i) =>
    [...effectiveTagIds(e, i)].some((id) => wanted.has(id)),
  )
}

export interface SidebarCounts {
  inbox: number
  today: number
  /** Items in Today whose deadline has passed: shown as a red badge. */
  overdue: number
}

export function sidebarCounts(e: Entities, ctx: ListContext): SidebarCounts {
  const t = today(e, ctx)
  const open = t.filter((i) => i.status === 'open')
  return {
    inbox: inbox(e, ctx).filter((i) => i.status === 'open').length,
    today: open.length,
    overdue: open.filter((i) => isOverdue(i, ctx)).length,
  }
}

export interface Progress {
  done: number
  total: number
}

/** Project pie: completed / (open + completed); canceled doesn't count. */
export function projectProgress(e: Entities, projectId: ID): Progress {
  let done = 0
  let total = 0
  for (const t of Object.values(e.todos)) {
    if (t.projectId !== projectId || t.trashedAt) continue
    if (t.status === 'canceled') continue
    total++
    if (t.status === 'completed') done++
  }
  return { done, total }
}

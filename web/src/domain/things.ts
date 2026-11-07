// Things 3 → Dayrule export mapping (PLAN.md §8.3).
// The Go tool `tools/things-export` reads Things' SQLite read-only and writes
// this intermediate JSON; the browser maps it to dayrule-export records and
// encrypts on save via importData.

import { keysBetween } from './order'
import type {
  Area,
  ChecklistItem,
  Heading,
  ID,
  LocalDate,
  OrderKey,
  Project,
  Repeat,
  StartBucket,
  Status,
  Tag,
  Todo,
} from './types'
import type { ExportData } from './exchange'

export const THINGS_EXPORT_FORMAT = 'dayrule-things-export'
export const THINGS_EXPORT_VERSION = 1

interface ThingsArea {
  id: string
  title: string
  order: number
  trashed?: boolean
  tagIds?: string[]
}

interface ThingsTag {
  id: string
  title: string
  parentId?: string
  order: number
}

interface ThingsProject {
  id: string
  title: string
  notes: string
  areaId?: string
  status: Status
  start: 'ready' | 'later'
  startDate?: LocalDate
  deadline?: LocalDate
  order: number
  todayOrder?: number
  completedAt?: string
  trashedAt?: string
  tagIds?: string[]
  createdAt: string
  updatedAt: string
}

interface ThingsHeading {
  id: string
  projectId: string
  title: string
  order: number
  archived?: boolean
  createdAt: string
  updatedAt: string
}

interface ThingsTodo {
  id: string
  title: string
  notes: string
  projectId?: string
  headingId?: string
  areaId?: string
  status: Status
  start: StartBucket
  startDate?: LocalDate
  deadline?: LocalDate
  order: number
  todayOrder?: number
  completedAt?: string
  trashedAt?: string
  reminderAt?: string
  tagIds?: string[]
  repeatTemplate?: boolean
  repeatNext?: LocalDate
  afterCompletion?: boolean
  /** Decoded from Things' recurrence plist (`fu` / `fa` / `of`). */
  repeatFreq?: Repeat['freq']
  repeatEvery?: number
  /** Dayrule weekdays: 0 = Monday … 6 = Sunday. */
  repeatWeekdays?: number[]
  createdAt: string
  updatedAt: string
}

interface ThingsChecklist {
  id: string
  todoId: string
  title: string
  done: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface ThingsExportData {
  format: typeof THINGS_EXPORT_FORMAT
  version: number
  thingsDatabaseVersion: number
  exportedAt: string
  areas: ThingsArea[]
  tags: ThingsTag[]
  projects: ThingsProject[]
  headings: ThingsHeading[]
  todos: ThingsTodo[]
  checklistItems: ThingsChecklist[]
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** True when the JSON looks like a things-export file (before full parse). */
export function looksLikeThingsExport(text: string): boolean {
  try {
    const raw = JSON.parse(text) as unknown
    return isObj(raw) && raw.format === THINGS_EXPORT_FORMAT
  } catch {
    return false
  }
}

/** Parse the JSON written by tools/things-export. Throws Error with a reason. */
export function parseThingsExport(text: string): ThingsExportData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t valid JSON.')
  }
  if (!isObj(raw) || raw.format !== THINGS_EXPORT_FORMAT) {
    throw new Error('This isn’t a Things export from things-export.')
  }
  if (raw.version !== THINGS_EXPORT_VERSION) {
    throw new Error(
      `This Things export is format version ${String(raw.version)}; this app reads version ${THINGS_EXPORT_VERSION}.`,
    )
  }
  const list = <T>(k: string): T[] => {
    const v = raw[k] ?? []
    if (!Array.isArray(v)) throw new Error(`"${k}" must be a list.`)
    if (v.length > 100_000) throw new Error(`Too many ${k}.`)
    return v as T[]
  }
  return {
    format: THINGS_EXPORT_FORMAT,
    version: THINGS_EXPORT_VERSION,
    thingsDatabaseVersion: Number(raw.thingsDatabaseVersion) || 0,
    exportedAt: String(raw.exportedAt ?? ''),
    areas: list('areas'),
    tags: list('tags'),
    projects: list('projects'),
    headings: list('headings'),
    todos: list('todos'),
    checklistItems: list('checklistItems'),
  }
}

function orderKeysFor(
  items: { order: number; id: string }[],
): Map<string, OrderKey> {
  const sorted = [...items].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  const keys = keysBetween(null, null, Math.max(sorted.length, 1))
  const map = new Map<string, OrderKey>()
  sorted.forEach((item, i) => map.set(item.id, keys[i]!))
  return map
}

function todayOrders(
  items: { id: string; todayOrder?: number }[],
): Map<string, OrderKey> {
  const withToday = items.filter(
    (x): x is { id: string; todayOrder: number } => x.todayOrder !== undefined,
  )
  if (!withToday.length) return new Map()
  const sorted = [...withToday].sort(
    (a, b) => a.todayOrder - b.todayOrder || a.id.localeCompare(b.id),
  )
  const keys = keysBetween(null, null, sorted.length)
  const map = new Map<string, OrderKey>()
  sorted.forEach((item, i) => map.set(item.id, keys[i]!))
  return map
}

function asRepeat(t: ThingsTodo): Repeat | undefined {
  if (!t.repeatTemplate) return undefined
  const anchor = t.repeatNext ?? t.startDate ?? t.createdAt.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return undefined
  const freq = t.repeatFreq ?? 'day'
  const every =
    typeof t.repeatEvery === 'number' &&
    Number.isInteger(t.repeatEvery) &&
    t.repeatEvery >= 1
      ? t.repeatEvery
      : 1
  const weekdays =
    freq === 'week' &&
    Array.isArray(t.repeatWeekdays) &&
    t.repeatWeekdays.length > 0 &&
    t.repeatWeekdays.every(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    )
      ? [...new Set(t.repeatWeekdays)].sort((a, b) => a - b)
      : undefined
  return {
    freq,
    every,
    ...(weekdays ? { weekdays } : {}),
    mode: t.afterCompletion ? 'afterCompletion' : 'fixed',
    anchor,
    next: t.afterCompletion ? undefined : (t.repeatNext ?? anchor),
  }
}

/**
 * Map a Things export into dayrule-export records (Things UUIDs kept as ids;
 * importData mints fresh ids on apply).
 */
export function mapThingsToExport(src: ThingsExportData): ExportData {
  const tagOrder = orderKeysFor(src.tags)
  const areaOrder = orderKeysFor(src.areas)
  const projectOrder = orderKeysFor(src.projects)
  const headingOrder = orderKeysFor(src.headings)
  const todoOrder = orderKeysFor(src.todos)
  const checkOrder = orderKeysFor(src.checklistItems)
  const projectToday = todayOrders(src.projects)
  const todoToday = todayOrders(src.todos)

  const tagIds = new Set(src.tags.map((t) => t.id))
  const areaIds = new Set(src.areas.map((a) => a.id))
  const projectIds = new Set(src.projects.map((p) => p.id))
  const headingIds = new Set(src.headings.map((h) => h.id))
  const todoIds = new Set(src.todos.map((t) => t.id))
  const stamp = src.exportedAt || new Date(0).toISOString()

  const tags: Tag[] = src.tags.map((t) => ({
    id: t.id as ID,
    type: 'tag',
    title: t.title || 'Untitled',
    parentId:
      t.parentId && tagIds.has(t.parentId) ? (t.parentId as ID) : undefined,
    order: tagOrder.get(t.id)!,
    createdAt: stamp,
    updatedAt: stamp,
  }))

  const areas: Area[] = src.areas.map((a) => ({
    id: a.id as ID,
    type: 'area',
    title: a.title || 'Untitled',
    order: areaOrder.get(a.id)!,
    tagIds: (a.tagIds ?? []).filter((id) => tagIds.has(id)) as ID[],
    trashedAt: a.trashed ? stamp : undefined,
    createdAt: stamp,
    updatedAt: stamp,
  }))

  const projects: Project[] = src.projects.map((p) => ({
    id: p.id as ID,
    type: 'project',
    title: p.title || 'Untitled',
    notes: p.notes ?? '',
    areaId: p.areaId && areaIds.has(p.areaId) ? (p.areaId as ID) : undefined,
    status: p.status,
    start: p.start,
    startDate: p.startDate,
    tonight: false,
    deadline: p.deadline,
    tagIds: (p.tagIds ?? []).filter((id) => tagIds.has(id)) as ID[],
    order: projectOrder.get(p.id)!,
    todayOrder: projectToday.get(p.id),
    completedAt: p.completedAt,
    trashedAt: p.trashedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))

  const headings: Heading[] = src.headings
    .filter((h) => projectIds.has(h.projectId))
    .map((h) => ({
      id: h.id as ID,
      type: 'heading',
      projectId: h.projectId as ID,
      title: h.title || 'Untitled',
      order: headingOrder.get(h.id)!,
      archived: !!h.archived,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }))

  const todos: Todo[] = src.todos.map((t) => {
    const projectId =
      t.projectId && projectIds.has(t.projectId)
        ? (t.projectId as ID)
        : undefined
    const headingId =
      t.headingId && headingIds.has(t.headingId) && projectId
        ? (t.headingId as ID)
        : undefined
    const repeat = asRepeat(t)
    return {
      id: t.id as ID,
      type: 'todo',
      title: t.title || 'Untitled',
      notes: t.notes ?? '',
      projectId,
      headingId,
      areaId:
        !projectId && t.areaId && areaIds.has(t.areaId)
          ? (t.areaId as ID)
          : undefined,
      status: t.status,
      start: t.start,
      startDate: repeat ? undefined : t.startDate,
      tonight: false,
      deadline: t.deadline,
      tagIds: (t.tagIds ?? []).filter((id) => tagIds.has(id)) as ID[],
      order: todoOrder.get(t.id)!,
      todayOrder: todoToday.get(t.id),
      completedAt: t.completedAt,
      trashedAt: t.trashedAt,
      reminderAt: t.reminderAt,
      repeat,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }
  })

  const checklistItems: ChecklistItem[] = src.checklistItems
    .filter((c) => todoIds.has(c.todoId))
    .map((c) => ({
      id: c.id as ID,
      type: 'checklistItem',
      todoId: c.todoId as ID,
      title: c.title || 'Untitled',
      done: !!c.done,
      order: checkOrder.get(c.id)!,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))

  return {
    areas,
    projects,
    headings,
    todos,
    checklistItems,
    tags,
  }
}

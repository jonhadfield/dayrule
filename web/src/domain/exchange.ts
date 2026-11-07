// Export and import (PLAN.md §8.1). Both run in the browser: an export is
// your data decrypted, and an import is encrypted again as it's saved.
//
// The JSON format is the entity records themselves, without sync clocks.
// Import validates every record and copies it in with new ids, so it never
// overwrites or brings back anything already in the account.

import { compareKeys } from './order'
import {
  looksLikeThingsExport,
  mapThingsToExport,
  parseThingsExport,
} from './things'
import type {
  Area,
  ChecklistItem,
  Entities,
  Heading,
  ID,
  Project,
  Repeat,
  Tag,
  Todo,
} from './types'

export const EXPORT_FORMAT = 'dayrule-export'
export const EXPORT_VERSION = 1

export interface ExportData {
  areas: Area[]
  projects: Project[]
  headings: Heading[]
  todos: Todo[]
  checklistItems: ChecklistItem[]
  tags: Tag[]
}

const COLLECTIONS = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
] as const

function stripClock<T extends { clock?: unknown }>(x: T): Omit<T, 'clock'> {
  const { clock: _clock, ...rest } = x
  return rest
}

export function exportJson(e: Entities, now: Date): string {
  const data = Object.fromEntries(
    COLLECTIONS.map((c) => [
      c,
      Object.values(e[c]).map((x) => stripClock(x as { clock?: unknown })),
    ]),
  )
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      ...data,
    },
    null,
    2,
  )
}

// ---------------------------------------------------------------------------
// Markdown: a readable outline, not meant for re-import.

export function exportMarkdown(e: Entities, now: Date): string {
  const live = <T extends { trashedAt?: string }>(xs: T[]) =>
    xs.filter((x) => !x.trashedAt)
  const ordered = <T extends { order: string; id: string }>(xs: T[]) =>
    [...xs].sort(
      (a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id),
    )
  const tagNames = (ids: ID[]) =>
    ids
      .map((id) => e.tags[id]?.title)
      .filter(Boolean)
      .map((t) => `#${t}`)
  const line = (t: Todo) => {
    const box =
      t.status === 'completed' ? '[x]' : t.status === 'canceled' ? '[-]' : '[ ]'
    const bits = [t.title || 'Untitled']
    if (t.startDate) bits.push(`(when: ${t.startDate})`)
    if (t.deadline) bits.push(`(deadline: ${t.deadline})`)
    bits.push(...tagNames(t.tagIds))
    const out = [`- ${box} ${bits.join(' ')}`]
    for (const n of t.notes.split('\n').filter((l) => l.trim()))
      out.push(`  > ${n}`)
    for (const c of ordered(
      Object.values(e.checklistItems).filter((c) => c.todoId === t.id),
    )) {
      out.push(`  - ${c.done ? '[x]' : '[ ]'} ${c.title}`)
    }
    return out.join('\n')
  }
  const todos = live(Object.values(e.todos))
  const parts: string[] = [
    `# Dayrule export`,
    ``,
    `Exported ${now.toISOString().slice(0, 10)}.`,
  ]

  const projectSection = (p: Project, level: string) => {
    const lines = [``, `${level} ${p.title || 'Untitled project'}`]
    if (p.notes.trim()) lines.push(``, p.notes.trim())
    const mine = ordered(todos.filter((t) => t.projectId === p.id))
    const loose = mine.filter((t) => !t.headingId || !e.headings[t.headingId])
    if (loose.length) lines.push(``, ...loose.map(line))
    for (const h of ordered(
      Object.values(e.headings).filter((h) => h.projectId === p.id),
    )) {
      const under = mine.filter((t) => t.headingId === h.id)
      lines.push(``, `${level}# ${h.title || 'Untitled heading'}`)
      if (under.length) lines.push(``, ...under.map(line))
    }
    return lines
  }

  const projects = ordered(live(Object.values(e.projects)))
  for (const a of ordered(live(Object.values(e.areas)))) {
    parts.push(``, `## ${a.title || 'Untitled area'}`)
    const own = ordered(todos.filter((t) => t.areaId === a.id && !t.projectId))
    if (own.length) parts.push(``, ...own.map(line))
    for (const p of projects.filter((p) => p.areaId === a.id))
      parts.push(...projectSection(p, '###'))
  }
  for (const p of projects.filter((p) => !p.areaId || !e.areas[p.areaId]))
    parts.push(...projectSection(p, '##'))
  const unfiled = ordered(todos.filter((t) => !t.projectId && !t.areaId))
  if (unfiled.length)
    parts.push(``, `## Not in a project or area`, ``, ...unfiled.map(line))
  return parts.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Import: validate everything before touching the store.

export class ImportError extends Error {}

type Raw = Record<string, unknown>
const isObj = (x: unknown): x is Raw =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const DATE = /^\d{4}-\d{2}-\d{2}$/

function str(
  r: Raw,
  k: string,
  where: string,
  opts: { optional?: boolean; max?: number } = {},
): string | undefined {
  const v = r[k]
  if (v === undefined || v === null) {
    if (opts.optional) return undefined
    throw new ImportError(`${where}: "${k}" is missing.`)
  }
  if (typeof v !== 'string')
    throw new ImportError(`${where}: "${k}" must be text.`)
  if (v.length > (opts.max ?? 100_000))
    throw new ImportError(`${where}: "${k}" is too long.`)
  return v
}
const req = (r: Raw, k: string, where: string, max?: number) =>
  str(r, k, where, { max })!
const opt = (r: Raw, k: string, where: string) =>
  str(r, k, where, { optional: true, max: 200 })
function date(r: Raw, k: string, where: string): string | undefined {
  const v = opt(r, k, where)
  if (v !== undefined && !DATE.test(v))
    throw new ImportError(`${where}: "${k}" must be a date like 2026-10-04.`)
  return v
}
function oneOf<T extends string>(
  r: Raw,
  k: string,
  where: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const v = r[k] ?? fallback
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ImportError(
      `${where}: "${k}" must be one of ${allowed.join(', ')}.`,
    )
  }
  return v as T
}
const ids = (r: Raw, k: string, where: string): ID[] => {
  const v = r[k] ?? []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new ImportError(`${where}: "${k}" must be a list of ids.`)
  }
  return v as ID[]
}
const bool = (r: Raw, k: string): boolean => r[k] === true

function base(r: Raw, where: string) {
  const now = new Date().toISOString()
  return {
    id: req(r, 'id', where, 200),
    createdAt: opt(r, 'createdAt', where) ?? now,
    updatedAt: opt(r, 'updatedAt', where) ?? now,
  }
}

const STATUS = ['open', 'completed', 'canceled'] as const
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function reminderAt(r: Raw, where: string): string | undefined {
  const v = opt(r, 'reminderAt', where)
  if (
    v !== undefined &&
    !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v)
  ) {
    throw new ImportError(
      `${where}: "reminderAt" must look like 2026-10-04T09:00.`,
    )
  }
  return v
}

function repeat(r: Raw, where: string): Repeat | undefined {
  const v = r.repeat
  if (v === undefined || v === null) return undefined
  if (!isObj(v)) throw new ImportError(`${where}: "repeat" must be a rule.`)
  const w = `${where} repeat`
  const every = v.every
  if (
    typeof every !== 'number' ||
    !Number.isInteger(every) ||
    every < 1 ||
    every > 99
  ) {
    throw new ImportError(`${w}: "every" must be a whole number from 1 to 99.`)
  }
  const weekdays = v.weekdays
  if (
    weekdays !== undefined &&
    (!Array.isArray(weekdays) ||
      !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ) {
    throw new ImportError(
      `${w}: "weekdays" must be days 0 (Monday) to 6 (Sunday).`,
    )
  }
  const anchor = date(v, 'anchor', w)
  if (!anchor) throw new ImportError(`${w}: "anchor" is missing.`)
  const reminderTime = opt(v, 'reminderTime', w)
  if (reminderTime !== undefined && !TIME.test(reminderTime)) {
    throw new ImportError(`${w}: "reminderTime" must look like 09:00.`)
  }
  return compact({
    freq: oneOf(v, 'freq', w, ['day', 'week', 'month', 'year'] as const),
    every,
    weekdays: weekdays as number[] | undefined,
    mode: oneOf(v, 'mode', w, ['fixed', 'afterCompletion'] as const),
    anchor,
    next: date(v, 'next', w),
    reminderTime,
  })
}

/** Parse and validate an export file. Throws ImportError with a reason.
 *  Accepts dayrule-export and dayrule-things-export (PLAN §8.3). */
export function parseImport(text: string): ExportData {
  if (looksLikeThingsExport(text)) {
    try {
      return mapThingsToExport(parseThingsExport(text))
    } catch (err) {
      throw new ImportError(
        err instanceof Error
          ? err.message
          : 'That Things file couldn’t be read.',
      )
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ImportError('This file isn’t valid JSON.')
  }
  if (!isObj(raw) || raw.format !== EXPORT_FORMAT) {
    throw new ImportError(
      'This isn’t a Dayrule export (or a Things export from things-export).',
    )
  }
  if (raw.version !== EXPORT_VERSION) {
    throw new ImportError(
      `This export is format version ${String(raw.version)}; this app reads version ${EXPORT_VERSION}.`,
    )
  }
  const list = (k: (typeof COLLECTIONS)[number]): Raw[] => {
    const v = raw[k] ?? []
    if (!Array.isArray(v) || !v.every(isObj))
      throw new ImportError(`"${k}" must be a list of records.`)
    if (v.length > 100_000) throw new ImportError(`Too many ${k}.`)
    return v
  }
  return {
    areas: list('areas').map((r, i) => {
      const w = `Area ${i + 1}`
      return {
        ...base(r, w),
        type: 'area',
        title: req(r, 'title', w),
        order: req(r, 'order', w, 200),
        tagIds: ids(r, 'tagIds', w),
        trashedAt: opt(r, 'trashedAt', w),
      }
    }),
    projects: list('projects').map((r, i) => {
      const w = `Project ${i + 1}`
      return {
        ...base(r, w),
        type: 'project',
        title: req(r, 'title', w),
        notes: str(r, 'notes', w, { optional: true }) ?? '',
        areaId: opt(r, 'areaId', w),
        status: oneOf(r, 'status', w, STATUS),
        start: oneOf(r, 'start', w, ['ready', 'later'] as const),
        startDate: date(r, 'startDate', w),
        tonight: bool(r, 'tonight'),
        deadline: date(r, 'deadline', w),
        tagIds: ids(r, 'tagIds', w),
        order: req(r, 'order', w, 200),
        todayOrder: opt(r, 'todayOrder', w),
        completedAt: opt(r, 'completedAt', w),
        trashedAt: opt(r, 'trashedAt', w),
      }
    }),
    headings: list('headings').map((r, i) => {
      const w = `Heading ${i + 1}`
      return {
        ...base(r, w),
        type: 'heading',
        projectId: req(r, 'projectId', w, 200),
        title: req(r, 'title', w),
        order: req(r, 'order', w, 200),
        archived: bool(r, 'archived'),
      }
    }),
    todos: list('todos').map((r, i) => {
      const w = `To-do ${i + 1}`
      return {
        ...base(r, w),
        type: 'todo',
        title: req(r, 'title', w),
        notes: str(r, 'notes', w, { optional: true }) ?? '',
        projectId: opt(r, 'projectId', w),
        headingId: opt(r, 'headingId', w),
        areaId: opt(r, 'areaId', w),
        status: oneOf(r, 'status', w, STATUS),
        start: oneOf(r, 'start', w, ['inbox', 'ready', 'later'] as const),
        startDate: date(r, 'startDate', w),
        tonight: bool(r, 'tonight'),
        deadline: date(r, 'deadline', w),
        tagIds: ids(r, 'tagIds', w),
        order: req(r, 'order', w, 200),
        todayOrder: opt(r, 'todayOrder', w),
        completedAt: opt(r, 'completedAt', w),
        trashedAt: opt(r, 'trashedAt', w),
        reminderAt: reminderAt(r, w),
        repeat: repeat(r, w),
        repeatTemplateId: opt(r, 'repeatTemplateId', w),
      }
    }),
    checklistItems: list('checklistItems').map((r, i) => {
      const w = `Checklist item ${i + 1}`
      return {
        ...base(r, w),
        type: 'checklistItem',
        todoId: req(r, 'todoId', w, 200),
        title: req(r, 'title', w),
        done: bool(r, 'done'),
        order: req(r, 'order', w, 200),
      }
    }),
    tags: list('tags').map((r, i) => {
      const w = `Tag ${i + 1}`
      return {
        ...base(r, w),
        type: 'tag',
        title: req(r, 'title', w),
        parentId: opt(r, 'parentId', w),
        order: req(r, 'order', w, 200),
      }
    }),
  }
}

/** Drop undefined fields, so imported records match ones made in the app. */
export function compact<T extends object>(x: T): T {
  return Object.fromEntries(
    Object.entries(x).filter(([, v]) => v !== undefined),
  ) as T
}

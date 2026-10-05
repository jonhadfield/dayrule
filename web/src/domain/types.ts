import type { FieldClock } from './merge'

// Domain model (PLAN.md §4). This is the plaintext shape, which only ever
// exists on the client.

/** Client-generated id (UUIDv7, so ids sort by creation time). */
export type ID = string

/** Local calendar date, `YYYY-MM-DD`. Never a timestamp: "today" is local. */
export type LocalDate = string

/** ISO 8601 timestamp. */
export type Timestamp = string

/** Fractional-index sort key. Compare with `<`/`>`, never localeCompare. */
export type OrderKey = string

export type Status = 'open' | 'completed' | 'canceled'

/**
 * Where an item sits before scheduling. A `startDate` (with `start` =
 * 'ready') means "scheduled": it shows in Scheduled until that date, then
 * in Today.
 */
export type StartBucket = 'inbox' | 'ready' | 'later'

interface Base {
  id: ID
  createdAt: Timestamp
  updatedAt: Timestamp
  /** Field → HLC stamp of its last write, for sync merges (§11.2). */
  clock?: FieldClock
}

export interface Area extends Base {
  type: 'area'
  title: string
  order: OrderKey
  tagIds: ID[]
  trashedAt?: Timestamp
}

export interface Project extends Base {
  type: 'project'
  title: string
  notes: string
  areaId?: ID
  status: Status
  start: Exclude<StartBucket, 'inbox'>
  startDate?: LocalDate
  tonight: boolean
  deadline?: LocalDate
  tagIds: ID[]
  order: OrderKey
  todayOrder?: OrderKey
  completedAt?: Timestamp
  trashedAt?: Timestamp
}

export interface Heading extends Base {
  type: 'heading'
  projectId: ID
  title: string
  order: OrderKey
  archived: boolean
}

/**
 * How a to-do repeats (PLAN.md §4.2). The to-do carrying it is a hidden
 * template; dated copies of it ("instances") are what show in the lists.
 */
export interface Repeat {
  freq: 'day' | 'week' | 'month' | 'year'
  /** Every N days/weeks/months/years. */
  every: number
  /** Weekly only: which days, 0 = Monday … 6 = Sunday. */
  weekdays?: number[]
  /** fixed: on a schedule from `anchor`. afterCompletion: N units after the last one is done. */
  mode: 'fixed' | 'afterCompletion'
  /** The first date; fixed schedules count from it. */
  anchor: LocalDate
  /** When the next instance is due; unset while waiting for completion. */
  next?: LocalDate
  /** Each instance gets a reminder at this local time ("HH:mm"). */
  reminderTime?: string
}

export interface Todo extends Base {
  type: 'todo'
  title: string
  notes: string
  /** At most one container chain: heading → project → area, or area alone. */
  projectId?: ID
  headingId?: ID
  areaId?: ID
  status: Status
  start: StartBucket
  startDate?: LocalDate
  tonight: boolean
  deadline?: LocalDate
  tagIds: ID[]
  order: OrderKey
  todayOrder?: OrderKey
  completedAt?: Timestamp
  trashedAt?: Timestamp
  /** A reminder at this local date and time, "YYYY-MM-DDTHH:mm" (§10.5). */
  reminderAt?: string
  /** Set on a template: makes this to-do repeat. */
  repeat?: Repeat
  /** Set on an instance: the template it came from. */
  repeatTemplateId?: ID
}

export interface ChecklistItem extends Base {
  type: 'checklistItem'
  todoId: ID
  title: string
  done: boolean
  order: OrderKey
}

export interface Tag extends Base {
  type: 'tag'
  title: string
  parentId?: ID
  order: OrderKey
}

/** When completed items move to Done (PLAN.md §4.1). */
export type DoneMode = 'immediately' | 'daily' | 'manually'

export interface Settings {
  clock?: FieldClock
  moveToDone: DoneMode
  /** Set by "Log Completed" when moveToDone is 'manually'. */
  lastMovedToDoneAt?: Timestamp
}

export interface Entities {
  areas: Record<ID, Area>
  projects: Record<ID, Project>
  headings: Record<ID, Heading>
  todos: Record<ID, Todo>
  checklistItems: Record<ID, ChecklistItem>
  tags: Record<ID, Tag>
  settings: Settings
}

export function emptyEntities(): Entities {
  return {
    areas: {},
    projects: {},
    headings: {},
    todos: {},
    checklistItems: {},
    tags: {},
    settings: { moveToDone: 'immediately' },
  }
}

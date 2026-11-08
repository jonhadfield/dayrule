// Every user action as a command over a Draft. Commands never mutate
// entities in place; they put new copies, so the Draft can record the
// before/after of each change for undo.

import type { WhenResult } from '../domain/dates'
import { compact, type ExportData } from '../domain/exchange'
import { keyAfterLast, keyBetween } from '../domain/order'
import type {
  Area,
  ChecklistItem,
  Heading,
  ID,
  LocalDate,
  DoneMode,
  Project,
  Status,
  Tag,
  Todo,
} from '../domain/types'
import type { Draft } from './draft'
import { onInstanceDone } from './repeats'

export interface Env {
  now: Date
  today: LocalDate
  newId: () => ID
}

type Item = Todo | Project

function stamp(env: Env): string {
  return env.now.toISOString()
}

function getItem(d: Draft, id: ID): Item | undefined {
  return d.get('todos', id) ?? d.get('projects', id)
}

function putItem(d: Draft, item: Item): void {
  if (item.type === 'todo') d.put('todos', item)
  else d.put('projects', item)
}

function touch<T extends { updatedAt: string }>(
  x: T,
  env: Env,
  patch: Partial<NoInfer<T>>,
): T {
  return { ...x, ...patch, updatedAt: stamp(env) }
}

function todayKeys(d: Draft, env: Env): string[] {
  return [...d.all('todos'), ...d.all('projects')]
    .filter((i) => i.startDate !== undefined && i.startDate <= env.today)
    .map((i) => i.todayOrder ?? i.order)
}

// ---------------------------------------------------------------------------
// To-dos

export type Placement =
  | { list: 'inbox' | 'today' | 'ready' | 'later' }
  | { list: 'project'; projectId: ID; headingId?: ID }
  | { list: 'area'; areaId: ID }

export interface NewTodo {
  title?: string
  notes?: string
  placement: Placement
}

export function createTodo(d: Draft, env: Env, input: NewTodo): Todo {
  const p = input.placement
  const siblings = d.all('todos').filter((t) => {
    if (p.list === 'project') {
      return t.projectId === p.projectId && t.headingId === p.headingId
    }
    if (p.list === 'area') return t.areaId === p.areaId && !t.projectId
    return !t.projectId && !t.areaId
  })

  const todo: Todo = {
    type: 'todo',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title: input.title ?? '',
    notes: input.notes ?? '',
    status: 'open',
    start: 'ready',
    tonight: false,
    tagIds: [],
    order: keyAfterLast(siblings.map((t) => t.order)),
  }

  switch (p.list) {
    case 'inbox':
      todo.start = 'inbox'
      break
    case 'today':
      todo.startDate = env.today
      todo.todayOrder = keyAfterLast(todayKeys(d, env))
      break
    case 'later':
      todo.start = 'later'
      break
    case 'project':
      todo.projectId = p.projectId
      if (p.headingId) todo.headingId = p.headingId
      break
    case 'area':
      todo.areaId = p.areaId
      break
    case 'ready':
      break
  }

  d.put('todos', todo)
  return todo
}

export function updateTodo(
  d: Draft,
  env: Env,
  id: ID,
  patch: Partial<Pick<Todo, 'title' | 'notes'>>,
): void {
  const t = d.get('todos', id)
  if (t) d.put('todos', touch(t, env, patch))
}

export function updateProject(
  d: Draft,
  env: Env,
  id: ID,
  patch: Partial<Pick<Project, 'title' | 'notes'>>,
): void {
  const p = d.get('projects', id)
  if (p) d.put('projects', touch(p, env, patch))
}

// ---------------------------------------------------------------------------
// Status

/**
 * Complete, cancel or reopen items. Closing a project closes its open
 * to-dos with the same status.
 */
export function setStatus(d: Draft, env: Env, ids: ID[], status: Status): void {
  const completedAt = status === 'open' ? undefined : stamp(env)
  for (const id of ids) {
    const item = getItem(d, id)
    if (!item || item.status === status) continue
    putItem(d, touch(item, env, { status, completedAt }))
    if (item.type === 'todo' && status !== 'open') onInstanceDone(d, env, item)

    if (item.type === 'project' && status !== 'open') {
      for (const t of d.all('todos')) {
        if (t.projectId === id && t.status === 'open') {
          d.put('todos', touch(t, env, { status, completedAt }))
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduling

export type When = WhenResult | { kind: 'ready' } | { kind: 'clear' }

export function setWhen(d: Draft, env: Env, ids: ID[], when: When): void {
  for (const id of ids) {
    const item = getItem(d, id)
    if (!item) continue

    let patch: Partial<Todo> & Partial<Project>
    switch (when.kind) {
      case 'today':
        patch = { start: 'ready', startDate: env.today, tonight: false }
        break
      case 'date':
        patch = { start: 'ready', startDate: when.date, tonight: false }
        break
      case 'later':
        patch = { start: 'later', startDate: undefined, tonight: false }
        break
      case 'ready':
        patch = { start: 'ready', startDate: undefined, tonight: false }
        break
      case 'clear':
        patch = { startDate: undefined, tonight: false }
        break
    }

    const entersToday =
      patch.startDate !== undefined &&
      patch.startDate <= env.today &&
      !(item.startDate !== undefined && item.startDate <= env.today)
    if (entersToday) patch.todayOrder = keyAfterLast(todayKeys(d, env))

    putItem(d, touch(item, env, patch) as Item)
  }
}

export function setDeadline(
  d: Draft,
  env: Env,
  ids: ID[],
  deadline: LocalDate | undefined,
): void {
  for (const id of ids) {
    const item = getItem(d, id)
    if (item) putItem(d, touch(item, env, { deadline }) as Item)
  }
}

export function setTags(d: Draft, env: Env, ids: ID[], tagIds: ID[]): void {
  for (const id of ids) {
    const item = getItem(d, id)
    if (item) putItem(d, touch(item, env, { tagIds: [...tagIds] }) as Item)
  }
}

// ---------------------------------------------------------------------------
// Moving and ordering

export type MoveTarget =
  | { kind: 'inbox' }
  | { kind: 'none' }
  | { kind: 'area'; areaId: ID }
  | { kind: 'project'; projectId: ID; headingId?: ID }

/** Move to-dos to another container, appending to its end. */
export function moveTodos(
  d: Draft,
  env: Env,
  ids: ID[],
  target: MoveTarget,
): void {
  for (const id of ids) {
    const t = d.get('todos', id)
    if (!t) continue
    const siblings = d.all('todos').filter((s) => {
      if (s.id === id) return false
      if (target.kind === 'project') {
        return (
          s.projectId === target.projectId && s.headingId === target.headingId
        )
      }
      if (target.kind === 'area')
        return s.areaId === target.areaId && !s.projectId
      return !s.projectId && !s.areaId
    })

    const next: Todo = touch(t, env, {
      projectId: target.kind === 'project' ? target.projectId : undefined,
      headingId: target.kind === 'project' ? target.headingId : undefined,
      areaId: target.kind === 'area' ? target.areaId : undefined,
      order: keyAfterLast(siblings.map((s) => s.order)),
    })
    if (target.kind === 'inbox') {
      next.start = 'inbox'
      next.startDate = undefined
      next.tonight = false
    } else if (next.start === 'inbox') {
      next.start = 'ready'
    }
    d.put('todos', next)
  }
}

export function moveProject(
  d: Draft,
  env: Env,
  id: ID,
  areaId: ID | undefined,
): void {
  const p = d.get('projects', id)
  if (!p) return
  const siblings = d
    .all('projects')
    .filter((s) => s.id !== id && s.areaId === areaId)
  d.put(
    'projects',
    touch(p, env, {
      areaId,
      order: keyAfterLast(siblings.map((s) => s.order)),
    }),
  )
}

export type OrderField = 'order' | 'todayOrder'

/**
 * Place an item between two neighbours in a displayed list. Only the moved
 * item's key changes.
 */
export function reorder(
  d: Draft,
  env: Env,
  collection: 'todos' | 'projects' | 'areas' | 'headings' | 'tags',
  id: ID,
  field: OrderField,
  neighbours: { before?: ID; after?: ID },
): void {
  const keyOf = (nid: ID | undefined): string | undefined => {
    if (!nid) return undefined
    const n = d.get(collection, nid) as
      { order: string; todayOrder?: string } | undefined
    return n
      ? field === 'todayOrder'
        ? (n.todayOrder ?? n.order)
        : n.order
      : undefined
  }
  const entity = d.get(collection, id)
  if (!entity) return
  const key = keyBetween(keyOf(neighbours.before), keyOf(neighbours.after))
  d.put(collection, touch(entity, env, { [field]: key }) as never)
}

// ---------------------------------------------------------------------------
// Trash

export function trashItems(d: Draft, env: Env, ids: ID[]): void {
  for (const id of ids) {
    const item = getItem(d, id)
    if (item && !item.trashedAt) {
      putItem(d, touch(item, env, { trashedAt: stamp(env) }) as Item)
    }
    const area = d.get('areas', id)
    if (area && !area.trashedAt) {
      d.put('areas', touch(area, env, { trashedAt: stamp(env) }))
    }
  }
}

export function restoreItems(d: Draft, env: Env, ids: ID[]): void {
  for (const id of ids) {
    const item = getItem(d, id)
    if (item?.trashedAt)
      putItem(d, touch(item, env, { trashedAt: undefined }) as Item)
    const area = d.get('areas', id)
    if (area?.trashedAt)
      d.put('areas', touch(area, env, { trashedAt: undefined }))
  }
}

/** Permanently delete trashed items and everything inside them. */
export function emptyTrash(d: Draft): void {
  const areaIds = new Set(
    d
      .all('areas')
      .filter((a) => a.trashedAt)
      .map((a) => a.id),
  )
  const projectIds = new Set(
    d
      .all('projects')
      .filter((p) => p.trashedAt || (p.areaId && areaIds.has(p.areaId)))
      .map((p) => p.id),
  )
  const todoIds = new Set(
    d
      .all('todos')
      .filter(
        (t) =>
          t.trashedAt ||
          (t.projectId && projectIds.has(t.projectId)) ||
          (t.areaId && areaIds.has(t.areaId)),
      )
      .map((t) => t.id),
  )

  for (const id of areaIds) d.remove('areas', id)
  for (const id of projectIds) d.remove('projects', id)
  for (const id of todoIds) d.remove('todos', id)
  for (const h of d.all('headings')) {
    if (projectIds.has(h.projectId)) d.remove('headings', h.id)
  }
  for (const c of d.all('checklistItems')) {
    if (todoIds.has(c.todoId)) d.remove('checklistItems', c.id)
  }
}

// ---------------------------------------------------------------------------
// Projects, areas, headings, tags

export function createProject(
  d: Draft,
  env: Env,
  input: { title: string; areaId?: ID },
): Project {
  const siblings = d.all('projects').filter((p) => p.areaId === input.areaId)
  const project: Project = {
    type: 'project',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title: input.title,
    notes: '',
    status: 'open',
    start: 'ready',
    tonight: false,
    tagIds: [],
    order: keyAfterLast(siblings.map((p) => p.order)),
    ...(input.areaId ? { areaId: input.areaId } : {}),
  }
  d.put('projects', project)
  return project
}

/**
 * Turn a to-do into a project (PLAN.md §8.2). Checklist items become to-dos
 * in the new project; the original to-do is removed.
 */
export function convertTodoToProject(d: Draft, env: Env, todoId: ID): Project {
  const t = d.get('todos', todoId)
  if (!t) throw new Error('to-do not found')
  const siblings = d.all('projects').filter((p) => p.areaId === t.areaId)
  const status: Status = t.status === 'canceled' ? 'open' : t.status
  const project: Project = {
    type: 'project',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title: t.title,
    notes: t.notes,
    status,
    start: t.start === 'inbox' ? 'ready' : (t.start as Project['start']),
    tonight: false,
    tagIds: [...t.tagIds],
    order: keyAfterLast(siblings.map((p) => p.order)),
    ...(t.startDate !== undefined ? { startDate: t.startDate } : {}),
    ...(t.deadline !== undefined ? { deadline: t.deadline } : {}),
    ...(t.areaId ? { areaId: t.areaId } : {}),
    ...(status !== 'open' ? { completedAt: t.completedAt ?? stamp(env) } : {}),
  }
  if (project.startDate !== undefined && project.startDate <= env.today) {
    project.todayOrder = keyAfterLast(todayKeys(d, env))
  }
  d.put('projects', project)

  const checks = d
    .all('checklistItems')
    .filter((c) => c.todoId === todoId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  for (const c of checks) {
    const child = createTodo(d, env, {
      title: c.title,
      placement: { list: 'project', projectId: project.id },
    })
    if (c.done) setStatus(d, env, [child.id], 'completed')
    d.remove('checklistItems', c.id)
  }
  d.remove('todos', todoId)
  return project
}

/**
 * Turn a project into a to-do. Child to-dos become checklist items; headings
 * are dropped. The project and its children are removed.
 */
export function convertProjectToTodo(d: Draft, env: Env, projectId: ID): Todo {
  const p = d.get('projects', projectId)
  if (!p) throw new Error('project not found')
  const children = d
    .all('todos')
    .filter((t) => t.projectId === projectId && !t.trashedAt)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

  const todo = createTodo(d, env, {
    title: p.title,
    notes: p.notes,
    placement: p.areaId
      ? { list: 'area', areaId: p.areaId }
      : { list: 'ready' },
  })
  const status: Status = p.status === 'canceled' ? 'open' : p.status
  const start: Todo['start'] =
    p.startDate !== undefined
      ? 'ready'
      : p.start === 'later'
        ? 'later'
        : todo.start
  const patched = touch(todo, env, {
    status,
    start,
    tagIds: [...p.tagIds],
    ...(p.startDate !== undefined ? { startDate: p.startDate } : {}),
    ...(p.deadline !== undefined ? { deadline: p.deadline } : {}),
    ...(status !== 'open' ? { completedAt: p.completedAt ?? stamp(env) } : {}),
    ...(p.startDate !== undefined && p.startDate <= env.today
      ? { todayOrder: keyAfterLast(todayKeys(d, env)) }
      : {}),
  })
  d.put('todos', patched)

  for (const c of children) {
    const item = addChecklistItem(d, env, patched.id, c.title)
    if (c.status === 'completed') {
      updateChecklistItem(d, env, item.id, { done: true })
    }
    for (const ch of d.all('checklistItems')) {
      if (ch.todoId === c.id) d.remove('checklistItems', ch.id)
    }
    d.remove('todos', c.id)
  }
  for (const h of d.all('headings')) {
    if (h.projectId === projectId) d.remove('headings', h.id)
  }
  d.remove('projects', projectId)
  return d.get('todos', patched.id)!
}

/**
 * Turn a heading into a project (PLAN.md §8.2). Its to-dos move into the new
 * project (no heading); the heading is removed. The new project shares the
 * parent project's area.
 */
export function convertHeadingToProject(
  d: Draft,
  env: Env,
  headingId: ID,
): Project {
  const h = d.get('headings', headingId)
  if (!h) throw new Error('heading not found')
  const parent = d.get('projects', h.projectId)
  const siblings = d.all('projects').filter((p) => p.areaId === parent?.areaId)
  const project: Project = {
    type: 'project',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title: h.title,
    notes: '',
    status: 'open',
    start: 'ready',
    tonight: false,
    tagIds: [],
    order: keyAfterLast(siblings.map((p) => p.order)),
    ...(parent?.areaId ? { areaId: parent.areaId } : {}),
  }
  d.put('projects', project)

  const children = d
    .all('todos')
    .filter((t) => t.headingId === headingId && !t.trashedAt)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  for (const t of children) {
    moveTodos(d, env, [t.id], { kind: 'project', projectId: project.id })
  }
  d.remove('headings', headingId)
  return project
}

export function createArea(d: Draft, env: Env, title: string): Area {
  const area: Area = {
    type: 'area',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title,
    tagIds: [],
    order: keyAfterLast(d.all('areas').map((a) => a.order)),
  }
  d.put('areas', area)
  return area
}

export function renameArea(d: Draft, env: Env, id: ID, title: string): void {
  const a = d.get('areas', id)
  if (a) d.put('areas', touch(a, env, { title }))
}

export function createHeading(
  d: Draft,
  env: Env,
  projectId: ID,
  title: string,
): Heading {
  const heading: Heading = {
    type: 'heading',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    projectId,
    title,
    archived: false,
    order: keyAfterLast(
      d
        .all('headings')
        .filter((h) => h.projectId === projectId)
        .map((h) => h.order),
    ),
  }
  d.put('headings', heading)
  return heading
}

export function updateHeading(
  d: Draft,
  env: Env,
  id: ID,
  patch: Partial<Pick<Heading, 'title' | 'archived'>>,
): void {
  const h = d.get('headings', id)
  if (h) d.put('headings', touch(h, env, patch))
}

/** Delete a heading; its to-dos stay in the project, without a heading. */
export function deleteHeading(d: Draft, env: Env, id: ID): void {
  for (const t of d.all('todos')) {
    if (t.headingId === id)
      d.put('todos', touch(t, env, { headingId: undefined }))
  }
  d.remove('headings', id)
}

export function createTag(
  d: Draft,
  env: Env,
  input: { title: string; parentId?: ID },
): Tag {
  const tag: Tag = {
    type: 'tag',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    title: input.title,
    order: keyAfterLast(d.all('tags').map((t) => t.order)),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  }
  d.put('tags', tag)
  return tag
}

export function renameTag(d: Draft, env: Env, id: ID, title: string): void {
  const t = d.get('tags', id)
  if (t) d.put('tags', touch(t, env, { title }))
}

/** Delete a tag and its children, removing them from everything tagged. */
export function deleteTag(d: Draft, env: Env, id: ID): void {
  const doomed = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const t of d.all('tags')) {
      if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) {
        doomed.add(t.id)
        grew = true
      }
    }
  }
  const strip = <T extends { tagIds: ID[]; updatedAt: string }>(
    x: T,
  ): T | null =>
    x.tagIds.some((t) => doomed.has(t))
      ? touch(x, env, {
          tagIds: x.tagIds.filter((t) => !doomed.has(t)),
        } as Partial<T>)
      : null
  for (const t of d.all('todos')) {
    const n = strip(t)
    if (n) d.put('todos', n)
  }
  for (const p of d.all('projects')) {
    const n = strip(p)
    if (n) d.put('projects', n)
  }
  for (const a of d.all('areas')) {
    const n = strip(a)
    if (n) d.put('areas', n)
  }
  for (const tid of doomed) d.remove('tags', tid)
}

// ---------------------------------------------------------------------------
// Checklists

export function addChecklistItem(
  d: Draft,
  env: Env,
  todoId: ID,
  title: string,
): ChecklistItem {
  const item: ChecklistItem = {
    type: 'checklistItem',
    id: env.newId(),
    createdAt: stamp(env),
    updatedAt: stamp(env),
    todoId,
    title,
    done: false,
    order: keyAfterLast(
      d
        .all('checklistItems')
        .filter((c) => c.todoId === todoId)
        .map((c) => c.order),
    ),
  }
  d.put('checklistItems', item)
  return item
}

export function updateChecklistItem(
  d: Draft,
  env: Env,
  id: ID,
  patch: Partial<Pick<ChecklistItem, 'title' | 'done'>>,
): void {
  const c = d.get('checklistItems', id)
  if (c) d.put('checklistItems', touch(c, env, patch))
}

export function removeChecklistItem(d: Draft, id: ID): void {
  d.remove('checklistItems', id)
}

// ---------------------------------------------------------------------------
// Done settings

export function setDoneMode(d: Draft, mode: DoneMode): void {
  d.settings = { ...d.settings, moveToDone: mode }
}

/** "Log Completed" for manual logging mode. */
export function moveToDoneNow(d: Draft, env: Env): void {
  d.settings = { ...d.settings, lastMovedToDoneAt: stamp(env) }
}

// ---------------------------------------------------------------------------
// Import (PLAN.md §8.1)

export interface ImportCounts {
  areas: number
  projects: number
  headings: number
  todos: number
  checklistItems: number
  tags: number
}

/**
 * Copy an export's records in with new ids, remapping every reference
 * between them. References to records not in the file are dropped, so an
 * import never points into (or overwrites) existing data.
 */
export function importData(d: Draft, env: Env, data: ExportData): ImportCounts {
  const now = env.now.toISOString()
  const map = new Map<ID, ID>()
  const fresh = (old: ID) => {
    const id = env.newId()
    map.set(old, id)
    return id
  }
  // Assign every new id first, so references resolve whatever the order.
  for (const c of [
    'areas',
    'projects',
    'headings',
    'todos',
    'checklistItems',
    'tags',
  ] as const) {
    for (const x of data[c]) fresh(x.id)
  }
  const ref = (old: ID | undefined) =>
    old === undefined ? undefined : map.get(old)
  const refs = (olds: ID[]) =>
    olds.map((o) => map.get(o)).filter((x): x is ID => x !== undefined)
  const stamp = { updatedAt: now }

  for (const t of data.tags) {
    d.put(
      'tags',
      compact({
        ...t,
        ...stamp,
        id: map.get(t.id)!,
        parentId: ref(t.parentId),
      }),
    )
  }
  for (const a of data.areas) {
    d.put(
      'areas',
      compact({ ...a, ...stamp, id: map.get(a.id)!, tagIds: refs(a.tagIds) }),
    )
  }
  for (const p of data.projects) {
    d.put(
      'projects',
      compact({
        ...p,
        ...stamp,
        id: map.get(p.id)!,
        areaId: ref(p.areaId),
        tagIds: refs(p.tagIds),
      }),
    )
  }
  const headings = new Map<ID, ID>() // new heading id → new project id
  for (const h of data.headings) {
    const projectId = ref(h.projectId)
    if (!projectId) continue // its project isn't in the file
    headings.set(map.get(h.id)!, projectId)
    d.put(
      'headings',
      compact({ ...h, ...stamp, id: map.get(h.id)!, projectId }),
    )
  }
  for (const t of data.todos) {
    const projectId = ref(t.projectId)
    const headingId = ref(t.headingId)
    d.put(
      'todos',
      compact({
        ...t,
        ...stamp,
        id: map.get(t.id)!,
        projectId,
        // Only keep a heading that belongs to the same project.
        headingId:
          headingId && projectId && headings.get(headingId) === projectId
            ? headingId
            : undefined,
        areaId: projectId ? undefined : ref(t.areaId),
        tagIds: refs(t.tagIds),
        repeatTemplateId: ref(t.repeatTemplateId),
      }),
    )
  }
  let checklist = 0
  for (const c of data.checklistItems) {
    const todoId = ref(c.todoId)
    if (!todoId) continue
    checklist++
    d.put(
      'checklistItems',
      compact({ ...c, ...stamp, id: map.get(c.id)!, todoId }),
    )
  }
  return {
    areas: data.areas.length,
    projects: data.projects.length,
    headings: headings.size,
    todos: data.todos.length,
    checklistItems: checklist,
    tags: data.tags.length,
  }
}

// ---------------------------------------------------------------------------
// Reminders (PLAN.md §10.5)

/**
 * Set or clear a reminder ("YYYY-MM-DDTHH:mm", local). On a repeating
 * to-do's template it sets the time each instance is reminded at.
 */
export function setReminder(
  d: Draft,
  env: Env,
  ids: ID[],
  at: string | null,
): void {
  for (const id of ids) {
    const t = d.get('todos', id)
    if (!t) continue
    if (t.repeat) {
      const { reminderTime: _r, ...rest } = t.repeat
      const repeat = at ? { ...rest, reminderTime: at.slice(11, 16) } : rest
      d.put('todos', touch(t, env, { repeat }))
    } else {
      d.put('todos', touch(t, env, { reminderAt: at ?? undefined }))
    }
  }
}

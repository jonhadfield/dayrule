// Repeating to-dos (PLAN.md §4.2): turning a to-do into a repeating
// template, and creating its dated instances when they come due.

import { v5 as uuidv5 } from 'uuid'
import { addLocalDays } from '../domain/dates'
import {
  dueAfterCompletion,
  occurrenceAfter,
  occurrenceOnOrAfter,
} from '../domain/repeat'
import type { ID, LocalDate, Repeat, Todo } from '../domain/types'
import type { Env } from './commands'
import type { Draft } from './draft'

/** Namespace for instance ids: uuidv5(template id + date). */
const INSTANCE_NS = '6b0f3c55-2f3e-4f6e-9b39-2b0d9a7e1c41'

export function instanceId(templateId: ID, date: LocalDate): ID {
  return uuidv5(`${templateId}/${date}`, INSTANCE_NS)
}

/** The first due date for a new or changed rule. */
function firstDue(r: Repeat, from: LocalDate): LocalDate {
  const start = r.anchor > from ? r.anchor : from
  return r.mode === 'fixed' ? occurrenceOnOrAfter(r, start) : start
}

/**
 * Make a to-do repeat, change how it repeats, or (with null) stop it.
 * The to-do becomes the hidden template; instances are created by
 * generateRepeats. Stopping deletes the template; instances stay.
 */
export function setRepeat(
  d: Draft,
  env: Env,
  id: ID,
  rule: Omit<Repeat, 'next'> | null,
): void {
  const t = d.get('todos', id)
  if (!t) return
  const now = env.now.toISOString()
  if (rule === null) {
    for (const c of d.all('checklistItems'))
      if (c.todoId === id) d.remove('checklistItems', c.id)
    d.remove('todos', id)
    return
  }
  // A change to an existing template starts from tomorrow, so the
  // instance already made for today isn't made again.
  const from = t.repeat ? addLocalDays(env.today, 1) : env.today
  const next =
    t.repeat && rule.mode === 'afterCompletion' && t.repeat.next === undefined
      ? undefined // still waiting for the current one to be done
      : firstDue(rule as Repeat, from)
  const { startDate: _s, ...rest } = t
  d.put('todos', {
    ...rest,
    status: 'open',
    start: t.start === 'inbox' ? 'ready' : t.start,
    tonight: false,
    completedAt: undefined,
    repeatTemplateId: undefined,
    repeat: { ...rule, ...(next ? { next } : {}) },
    updatedAt: now,
  })
}

/**
 * Create instances that have come due, and move each template's `next`
 * on. Idempotent. Only the latest missed occurrence of a fixed schedule is
 * created, so a week away doesn't leave seven copies of a daily to-do.
 * Returns the keys of the records it created (see EntityStore.generate).
 */
export function generateRepeats(d: Draft, env: Env): Set<string> {
  const created = new Set<string>()
  for (const template of d.all('todos')) {
    const r = template.repeat
    if (!r?.next || r.next > env.today || template.trashedAt) continue
    let date: LocalDate
    let next: LocalDate | undefined
    if (r.mode === 'fixed') {
      date = r.next
      next = occurrenceAfter(r, date)
      while (next <= env.today) {
        date = next
        next = occurrenceAfter(r, date)
      }
    } else {
      date = r.next
      next = undefined // waits until this one is done
    }
    makeInstance(d, template, date, created)
    const { next: _n, ...rest } = r
    d.put('todos', {
      ...template,
      repeat: next ? { ...rest, next } : rest,
      updatedAt: env.now.toISOString(),
    })
  }
  return created
}

/**
 * Everything in an instance is derived from the template and the date, so
 * two devices that create the same occurrence offline make identical
 * records, which merge into one.
 */
function makeInstance(
  d: Draft,
  template: Todo,
  date: LocalDate,
  created: Set<string>,
) {
  const id = instanceId(template.id, date)
  if (d.get('todos', id)) return
  const at = `${date}T00:00:00.000Z`
  const instance: Todo = {
    type: 'todo',
    id,
    title: template.title,
    notes: template.notes,
    ...(template.projectId ? { projectId: template.projectId } : {}),
    ...(template.headingId ? { headingId: template.headingId } : {}),
    ...(template.areaId ? { areaId: template.areaId } : {}),
    status: 'open',
    start: 'ready',
    startDate: date,
    tonight: false,
    tagIds: [...template.tagIds],
    order: template.order,
    repeatTemplateId: template.id,
    ...(template.repeat?.reminderTime
      ? { reminderAt: `${date}T${template.repeat.reminderTime}` }
      : {}),
    createdAt: at,
    updatedAt: at,
  }
  d.put('todos', instance)
  created.add(`todos/${id}`)
  for (const c of d.all('checklistItems')) {
    if (c.todoId !== template.id) continue
    const cid = uuidv5(`${id}/${c.id}`, INSTANCE_NS)
    d.put('checklistItems', {
      ...c,
      id: cid,
      todoId: id,
      done: false,
      createdAt: at,
      updatedAt: at,
      clock: undefined,
    })
    created.add(`checklistItems/${cid}`)
  }
}

/** An instance of an after-completion repeat was done: schedule the next. */
export function onInstanceDone(d: Draft, env: Env, instance: Todo): void {
  if (!instance.repeatTemplateId) return
  const template = d.get('todos', instance.repeatTemplateId)
  const r = template?.repeat
  if (!template || !r || r.mode !== 'afterCompletion' || r.next !== undefined)
    return
  d.put('todos', {
    ...template,
    repeat: { ...r, next: dueAfterCompletion(r, env.today) },
    updatedAt: env.now.toISOString(),
  })
}

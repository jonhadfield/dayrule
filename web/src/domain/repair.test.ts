import { describe, expect, it } from 'vitest'
import { withRepairs } from './repair'
import { emptyEntities, type Entities } from './types'

const base = { createdAt: '', updatedAt: '', order: 'a0' }

function sample(): Entities {
  const e = emptyEntities()
  e.areas.a = {
    ...base,
    type: 'area',
    id: 'a',
    title: 'A',
    tagIds: [],
  } as never
  e.projects.p = {
    ...base,
    type: 'project',
    id: 'p',
    title: 'P',
    areaId: 'a',
    tagIds: [],
    status: 'open',
    start: 'ready',
  } as never
  e.headings.h = {
    ...base,
    type: 'heading',
    id: 'h',
    projectId: 'p',
    title: 'H',
    archived: false,
  }
  e.tags.t = { ...base, type: 'tag', id: 't', title: 'T' } as never
  e.todos.x = {
    ...base,
    type: 'todo',
    id: 'x',
    title: 'X',
    notes: '',
    projectId: 'p',
    headingId: 'h',
    status: 'open',
    start: 'ready',
    tonight: false,
    tagIds: ['t'],
  }
  e.checklistItems.c = {
    ...base,
    type: 'checklistItem',
    id: 'c',
    todoId: 'x',
    title: '',
    done: false,
  } as never
  return e
}

describe('withRepairs', () => {
  it('returns the same object when nothing dangles', () => {
    const e = sample()
    expect(withRepairs(e)).toBe(e)
  })

  it('moves a to-do whose project is gone to the Inbox, without its heading', () => {
    const e = sample()
    delete e.projects.p
    const r = withRepairs(e)
    expect(r.todos.x).toMatchObject({ start: 'inbox' })
    expect(r.todos.x?.projectId).toBeUndefined()
    expect(r.todos.x?.headingId).toBeUndefined()
    expect(r.headings.h).toBeUndefined()
    expect(e.todos.x?.projectId).toBe('p') // the data itself is untouched
  })

  it('keeps a scheduled to-do scheduled when its project is gone', () => {
    const e = sample()
    e.todos.x = { ...e.todos.x!, startDate: '2026-10-10' }
    delete e.projects.p
    expect(withRepairs(e).todos.x?.start).toBe('ready')
  })

  it('drops missing tags, areas, headings and orphaned checklist items', () => {
    const e = sample()
    delete e.tags.t
    delete e.areas.a
    delete e.headings.h
    const r = withRepairs(e)
    expect(r.todos.x?.tagIds).toEqual([])
    expect(r.todos.x?.headingId).toBeUndefined()
    expect(r.todos.x?.projectId).toBe('p')
    expect(r.projects.p?.areaId).toBeUndefined()

    // The store replaces the entities object on every change.
    expect(withRepairs({ ...e, todos: {} }).checklistItems.c).toBeUndefined()
  })

  it('is cached per entities object', () => {
    const e = sample()
    delete e.projects.p
    expect(withRepairs(e)).toBe(withRepairs(e))
  })
})

import { describe, expect, it } from 'vitest'
import { buildFinder, homeOf } from './find'
import { World } from './fixtures'
import type { ListContext } from './lists'

const ctx: ListContext = { today: '2026-10-04' }

describe('Quick Find', () => {
  it('finds lists, projects and to-dos by prefix and with typos', () => {
    const w = new World()
    const p = w.project({ title: 'Garden shed' })
    const t = w.todo({
      title: 'Buy timber',
      notes: 'treated pine',
      projectId: p.id,
    })
    const f = buildFinder(w.e, ctx)

    expect(f.search('tod')[0]).toMatchObject({ kind: 'list', path: '/today' })
    expect(f.search('gard')[0]).toMatchObject({
      kind: 'project',
      path: `/project/${p.id}`,
    })
    expect(f.search('timbr')[0]).toMatchObject({
      kind: 'todo',
      todoId: t.id,
      path: `/project/${p.id}`,
      detail: 'Garden shed',
    })
    expect(f.search('pine')[0]?.todoId).toBe(t.id) // notes
    expect(f.search('')).toEqual([])
  })

  it('finds to-dos by tag name and needs every word to match', () => {
    const w = new World()
    const errand = w.tag({ title: 'Errand' })
    const a = w.todo({ title: 'Post parcel', tagIds: [errand.id] })
    w.todo({ title: 'Post letter' })
    const f = buildFinder(w.e, ctx)
    expect(f.search('errand').map((r) => r.todoId)).toEqual([a.id])
    expect(f.search('post parcel').map((r) => r.todoId)).toEqual([a.id])
  })

  it('leaves out trashed projects and areas', () => {
    const w = new World()
    w.project({ title: 'Old plan', trashedAt: '2026-10-01T00:00:00Z' })
    w.area({ title: 'Old area', trashedAt: '2026-10-01T00:00:00Z' })
    expect(buildFinder(w.e, ctx).search('old')).toEqual([])
  })
})

describe('homeOf', () => {
  it('names the list each to-do shows in', () => {
    const w = new World()
    const home = (p: Parameters<World['todo']>[0]) =>
      homeOf(w.e, w.todo(p), ctx).path
    expect(home({ start: 'inbox' })).toBe('/inbox')
    expect(home({ start: 'ready', startDate: '2026-10-04' })).toBe('/today')
    expect(home({ start: 'ready', deadline: '2026-10-03' })).toBe('/today')
    expect(home({ start: 'ready', startDate: '2026-10-09' })).toBe('/scheduled')
    expect(home({ start: 'ready' })).toBe('/backlog')
    expect(home({ start: 'later' })).toBe('/backlog')
    expect(home({ trashedAt: '2026-10-01T00:00:00Z' })).toBe('/trash')
    expect(
      home({ status: 'completed', completedAt: '2026-10-01T10:00:00Z' }),
    ).toBe('/done')
    const area = w.area()
    expect(home({ areaId: area.id })).toBe(`/area/${area.id}`)
  })
})

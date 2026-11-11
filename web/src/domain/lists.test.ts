import { describe, expect, it } from 'vitest'
import { World } from './fixtures'
import {
  backlog,
  areaView,
  filterByTag,
  inbox,
  doneList,
  projectProgress,
  projectView,
  sidebarCounts,
  notNow,
  today,
  trash,
  scheduled,
  type ListContext,
} from './lists'

const ctx: ListContext = { today: '2026-10-04' }
const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('inbox', () => {
  it('holds unfiled, unscheduled open to-dos in order', () => {
    const w = new World()
    const a = w.todo()
    const b = w.todo()
    w.todo({ start: 'ready' })
    w.todo({ start: 'later' })
    w.todo({ trashedAt: '2026-10-02T00:00:00Z' })
    expect(ids(inbox(w.e, ctx))).toEqual([a.id, b.id])
  })

  it('never contains to-dos inside a project or area', () => {
    const w = new World()
    const p = w.project()
    const area = w.area()
    w.todo({ projectId: p.id })
    w.todo({ areaId: area.id })
    expect(inbox(w.e, ctx)).toEqual([])
  })
})

describe('today', () => {
  it('shows items started or due by today, split by tonight', () => {
    const w = new World()
    const started = w.todo({ start: 'ready', startDate: '2026-10-04' })
    const overdueStart = w.todo({ start: 'ready', startDate: '2026-09-30' })
    const dueToday = w.todo({ start: 'ready', deadline: '2026-10-04' })
    const tonight = w.todo({
      start: 'ready',
      startDate: '2026-10-04',
      tonight: true,
    })
    const project = w.project({ startDate: '2026-10-04' })
    w.todo({ start: 'ready', startDate: '2026-10-05' })
    w.todo({ start: 'ready' })

    const t = today(w.e, ctx)
    // A to-do marked for the evening by an older version is just in Today.
    expect(new Set(ids(t))).toEqual(
      new Set([
        started.id,
        overdueStart.id,
        dueToday.id,
        project.id,
        tonight.id,
      ]),
    )
  })

  it('sorts by todayOrder, falling back to order', () => {
    const w = new World()
    const a = w.todo({ start: 'ready', startDate: '2026-10-04' })
    const b = w.todo({ start: 'ready', startDate: '2026-10-04' })
    b.todayOrder = 'a0'
    a.todayOrder = 'a1'
    expect(ids(today(w.e, ctx))).toEqual([b.id, a.id])
  })

  it('excludes items in a Later project', () => {
    const w = new World()
    const p = w.project({ start: 'later' })
    w.todo({ projectId: p.id, start: 'ready', startDate: '2026-10-04' })
    expect(today(w.e, ctx)).toEqual([])
  })

  it('keeps completed items until they are logged', () => {
    const w = new World()
    const done = w.todo({
      start: 'ready',
      startDate: '2026-10-04',
      status: 'completed',
      completedAt: '2026-10-04T10:00:00Z',
    })

    w.e.settings.moveToDone = 'immediately'
    expect(today(w.e, ctx)).toEqual([])

    w.e.settings.moveToDone = 'daily'
    expect(ids(today(w.e, ctx))).toEqual([done.id])
    expect(today(w.e, { today: '2026-10-05' })).toEqual([])

    w.e.settings.moveToDone = 'manually'
    expect(ids(today(w.e, ctx))).toEqual([done.id])
    w.e.settings.lastMovedToDoneAt = '2026-10-04T11:00:00Z'
    expect(today(w.e, ctx)).toEqual([])
  })
})

describe('scheduled', () => {
  it('lists the next 7 days, then later items by month', () => {
    const w = new World()
    const tomorrow = w.todo({ start: 'ready', startDate: '2026-10-05' })
    const day7 = w.todo({ start: 'ready', startDate: '2026-10-11' })
    const day8 = w.todo({ start: 'ready', startDate: '2026-10-12' })
    const nov = w.todo({ start: 'ready', startDate: '2026-11-20' })
    w.todo({ start: 'ready', startDate: '2026-10-04' })

    const u = scheduled(w.e, ctx)
    expect(u.days.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ])
    expect(ids(u.days[0]?.items ?? [])).toEqual([tomorrow.id])
    expect(ids(u.days[6]?.items ?? [])).toEqual([day7.id])
    expect(u.months).toEqual([
      { month: '2026-10', items: [day8] },
      { month: '2026-11', items: [nov] },
    ])
  })
})

describe('ready', () => {
  it('groups available to-dos: loose first, then by area and project', () => {
    const w = new World()
    const area = w.area()
    const inArea = w.project({ areaId: area.id })
    const loneProject = w.project()
    const loose = w.todo({ start: 'ready' })
    const areaTodo = w.todo({ start: 'ready', areaId: area.id })
    const p1 = w.todo({ start: 'ready', projectId: inArea.id })
    const p2 = w.todo({ start: 'ready', projectId: loneProject.id })
    w.todo({ start: 'ready', startDate: '2026-10-05' })
    w.todo()

    const groups = backlog(w.e, ctx)
    expect(groups.map((g) => g.container.kind)).toEqual([
      'none',
      'area',
      'project',
      'project',
    ])
    expect(groups.map((g) => ids(g.todos))).toEqual([
      [loose.id],
      [areaTodo.id],
      [p1.id],
      [p2.id],
    ])
  })

  it('hides to-dos in Later or closed projects', () => {
    const w = new World()
    const later = w.project({ start: 'later' })
    const closed = w.project({
      status: 'completed',
      completedAt: '2026-10-03T00:00:00Z',
    })
    w.todo({ start: 'ready', projectId: later.id })
    w.todo({ start: 'ready', projectId: closed.id })
    expect(backlog(w.e, ctx)).toEqual([])
  })
})

describe('later', () => {
  it('lists Later projects and loose Later to-dos', () => {
    const w = new World()
    const p = w.project({ start: 'later' })
    const t = w.todo({ start: 'later' })
    w.todo({ start: 'later', projectId: p.id })
    const s = notNow(w.e, ctx)
    expect(ids(s.projects)).toEqual([p.id])
    expect(ids(s.todos)).toEqual([t.id])
  })
})

describe('done list', () => {
  it('groups logged items by day, newest first', () => {
    const w = new World()
    const old = w.todo({
      status: 'completed',
      completedAt: '2026-10-02T09:00:00',
    })
    const recent = w.todo({
      status: 'canceled',
      completedAt: '2026-10-04T09:00:00',
    })
    const recent2 = w.project({
      status: 'completed',
      completedAt: '2026-10-04T08:00:00',
    })
    const days = doneList(w.e, ctx)
    expect(days.map((d) => [d.date, ids(d.items)])).toEqual([
      ['2026-10-04', [recent.id, recent2.id]],
      ['2026-10-02', [old.id]],
    ])
  })
})

describe('trash', () => {
  it('lists directly trashed items and areas, newest first', () => {
    const w = new World()
    const p = w.project({ trashedAt: '2026-10-03T00:00:00Z' })
    w.todo({ projectId: p.id })
    const t = w.todo({ trashedAt: '2026-10-04T00:00:00Z' })
    const area = w.area({ trashedAt: '2026-10-01T00:00:00Z' })
    const list = trash(w.e)
    expect(ids(list.items)).toEqual([t.id, p.id])
    expect(ids(list.areas)).toEqual([area.id])
  })

  it('hides to-dos whose project is trashed from every list', () => {
    const w = new World()
    const p = w.project({ trashedAt: '2026-10-03T00:00:00Z' })
    w.todo({ projectId: p.id, start: 'ready', startDate: '2026-10-04' })
    expect(today(w.e, ctx)).toEqual([])
    expect(backlog(w.e, ctx)).toEqual([])
  })
})

describe('project and area views', () => {
  it('groups project to-dos under headings', () => {
    const w = new World()
    const p = w.project()
    const h = w.heading({ projectId: p.id })
    const loose = w.todo({ projectId: p.id, start: 'ready' })
    const under = w.todo({ projectId: p.id, headingId: h.id, start: 'ready' })
    const v = projectView(w.e, p.id, ctx)
    expect(ids(v?.todos ?? [])).toEqual([loose.id])
    expect(v?.headings.map((g) => ids(g.todos))).toEqual([[under.id]])
  })

  it('shows an area’s open projects and loose to-dos', () => {
    const w = new World()
    const area = w.area()
    const p = w.project({ areaId: area.id })
    const t = w.todo({ areaId: area.id, start: 'ready' })
    w.todo({ areaId: area.id, start: 'later' })
    const v = areaView(w.e, area.id, ctx)
    expect(ids(v?.projects ?? [])).toEqual([p.id])
    expect(ids(v?.todos ?? [])).toEqual([t.id])
  })
})

describe('tags', () => {
  it('matches child tags and tags inherited from project and area', () => {
    const w = new World()
    const work = w.tag({ title: 'Work' })
    const calls = w.tag({ title: 'Calls', parentId: work.id })
    const area = w.area({ tagIds: [work.id] })
    const p = w.project({ areaId: area.id })
    const direct = w.todo({ tagIds: [calls.id] })
    const inherited = w.todo({ projectId: p.id })
    const other = w.todo()
    const all = [direct, inherited, other]
    expect(ids(filterByTag(w.e, all, work.id))).toEqual([
      direct.id,
      inherited.id,
    ])
    expect(ids(filterByTag(w.e, all, calls.id))).toEqual([direct.id])
    expect(filterByTag(w.e, all, null)).toBe(all)
  })
})

describe('counts and progress', () => {
  it('counts open Inbox and Today items, and overdue deadlines', () => {
    const w = new World()
    w.todo()
    w.todo({ start: 'ready', startDate: '2026-10-04' })
    w.todo({ start: 'ready', deadline: '2026-10-01' })
    expect(sidebarCounts(w.e, ctx)).toEqual({ inbox: 1, today: 2, overdue: 1 })
  })

  it('ignores canceled to-dos in project progress', () => {
    const w = new World()
    const p = w.project()
    w.todo({ projectId: p.id, status: 'completed' })
    w.todo({ projectId: p.id })
    w.todo({ projectId: p.id, status: 'canceled' })
    expect(projectProgress(w.e, p.id)).toEqual({ done: 1, total: 2 })
  })
})

describe('keepVisible', () => {
  it('keeps a just-completed item in its list until released', () => {
    const w = new World()
    const t = w.todo({
      start: 'ready',
      startDate: '2026-10-04',
      status: 'completed',
      completedAt: '2026-10-04T10:00:00Z',
    })
    expect(today(w.e, ctx)).toEqual([])
    expect(
      today(w.e, { ...ctx, keepVisible: new Set([t.id]) }).map((i) => i.id),
    ).toEqual([t.id])
  })
})

/**
 * PLAN §16 DoD: one seed vault that asserts every §4.1 list rule together
 * (unit cases above cover edges; this is the single acceptance walk).
 */
describe('PLAN §4.1 acceptance', () => {
  it('places one vault’s items into Inbox, Today, Scheduled, Backlog, Not now, Done and Trash', () => {
    const w = new World()
    w.e.settings.moveToDone = 'immediately'
    const day: ListContext = { today: '2026-10-04' }

    const area = w.area({ title: 'Home' })
    const kitchen = w.project({ title: 'Kitchen', areaId: area.id })
    const laterProj = w.project({ title: 'Someday', start: 'later' })
    const heading = w.heading({ projectId: kitchen.id, title: 'Chores' })

    const inboxItem = w.todo({ title: 'Buy milk' })
    const todayStarted = w.todo({
      title: 'Today chore',
      start: 'ready',
      startDate: '2026-10-04',
      todayOrder: 'a1',
    })
    const overdue = w.todo({
      title: 'Overdue',
      start: 'ready',
      deadline: '2026-09-30',
      todayOrder: 'a0',
    })
    const tomorrow = w.todo({
      title: 'Tomorrow',
      start: 'ready',
      startDate: '2026-10-05',
    })
    const nextMonth = w.todo({
      title: 'November',
      start: 'ready',
      startDate: '2026-11-20',
    })
    const backlogLoose = w.todo({ title: 'Anytime', start: 'ready' })
    const backlogInProject = w.todo({
      title: 'Clean sink',
      start: 'ready',
      projectId: kitchen.id,
      headingId: heading.id,
    })
    const notNowTodo = w.todo({ title: 'Maybe later', start: 'later' })
    // In a Not now project: hidden from Today even with a When of today.
    w.todo({
      title: 'Someday chore',
      start: 'ready',
      startDate: '2026-10-04',
      projectId: laterProj.id,
    })
    const logged = w.todo({
      title: 'Finished',
      status: 'completed',
      completedAt: '2026-10-03T12:00:00Z',
    })
    const trashed = w.todo({
      title: 'Gone',
      trashedAt: '2026-10-02T00:00:00Z',
    })
    // Repeating template: only in Scheduled as its next date (§4.2).
    const template = w.todo({
      title: 'Daily template',
      start: 'ready',
      repeat: {
        freq: 'day',
        every: 1,
        mode: 'fixed',
        anchor: '2026-10-01',
        next: '2026-10-06',
      },
    })

    expect(ids(inbox(w.e, day))).toEqual([inboxItem.id])

    // Overdue deadline + started today; Not now project child excluded.
    expect(ids(today(w.e, day))).toEqual([overdue.id, todayStarted.id])

    const sched = scheduled(w.e, day)
    expect(ids(sched.days[0]?.items ?? [])).toEqual([tomorrow.id])
    expect(ids(sched.days[1]?.items ?? [])).toEqual([template.id])
    expect(sched.months.map((m) => [m.month, ids(m.items)] as const)).toEqual([
      ['2026-11', [nextMonth.id]],
    ])
    expect(sched.waiting).toEqual([])

    const backlogIds = new Set(
      backlog(w.e, day).flatMap((g) => g.todos.map((t) => t.id)),
    )
    // Undated ready items (and today’s When, which is also “available”).
    expect(backlogIds).toEqual(
      new Set([
        backlogLoose.id,
        backlogInProject.id,
        todayStarted.id,
        overdue.id,
      ]),
    )
    expect(backlogIds.has(tomorrow.id)).toBe(false)
    expect(backlogIds.has(notNowTodo.id)).toBe(false)

    const aside = notNow(w.e, day)
    expect(ids(aside.projects)).toEqual([laterProj.id])
    expect(ids(aside.todos)).toEqual([notNowTodo.id])

    expect(doneList(w.e, day).flatMap((d) => d.items.map((i) => i.id))).toEqual(
      [logged.id],
    )
    expect(ids(trash(w.e).items)).toEqual([trashed.id])

    // Template stays out of every ordinary list.
    expect(ids(inbox(w.e, day))).not.toContain(template.id)
    expect(ids(today(w.e, day))).not.toContain(template.id)
    expect(backlogIds.has(template.id)).toBe(false)

    const view = projectView(w.e, kitchen.id, day)
    expect(ids(view?.todos ?? [])).toEqual([])
    expect(view?.headings.map((g) => ids(g.todos))).toEqual([
      [backlogInProject.id],
    ])
    expect(ids(areaView(w.e, area.id, day)?.projects ?? [])).toEqual([
      kitchen.id,
    ])
    expect(sidebarCounts(w.e, day)).toEqual({
      inbox: 1,
      today: 2,
      overdue: 1,
    })
  })
})

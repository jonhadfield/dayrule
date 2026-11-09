// Known-answer domain vectors for the native companion (dayrule-apple PLAN §16).
// Regenerate: WRITE_DOMAIN_VECTORS=1 pnpm --filter web test src/domain/domain-vectors.test.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWhen } from './dates'
import { Hlc } from './hlc'
import {
  latestStamp,
  mergeEntity,
  resolveTombstone,
  type Clocked,
} from './merge'
import { compareKeys, keyBetween, keysBetween } from './order'
import {
  dueAfterCompletion,
  occurrenceAfter,
  occurrenceOnOrAfter,
} from './repeat'
import { emptyEntities, type Repeat, type Todo } from './types'
import { generateRepeats, instanceId } from '../store/repeats'
import { createEntityStore, type Clock } from '../store/store'
import { World } from './fixtures'
import { buildFinder, homeOf } from './find'
import {
  effectiveTagIds,
  inbox,
  notNow,
  projectView,
  scheduled,
  sidebarCounts,
  today as todayList,
  type ListContext,
} from './lists'

type MergeE = Clocked & {
  id: string
  title?: string
  notes?: string
  done?: boolean
}

const FILE = path.resolve(
  import.meta.dirname,
  '../../../docs/shared/domain-vectors.json',
)

type WhenCase = {
  input: string
  today: string // YYYY-MM-DD local calendar day
  result: unknown
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function build() {
  const today = '2026-10-04' // Sunday
  const wed = '2026-10-07'
  const parseWhenCases: WhenCase[] = [
    ['today', today, { kind: 'today' }],
    ['Today ', today, { kind: 'today' }],
    ['tonight', today, { kind: 'today' }],
    ['later', today, { kind: 'later' }],
    ['tom', today, { kind: 'date', date: '2026-10-05' }],
    ['tomorrow', today, { kind: 'date', date: '2026-10-05' }],
    ['in 3 days', today, { kind: 'date', date: '2026-10-07' }],
    ['in 2 weeks', today, { kind: 'date', date: '2026-10-18' }],
    ['in 1 month', today, { kind: 'date', date: '2026-11-04' }],
    ['next week', today, { kind: 'date', date: '2026-10-05' }],
    ['next month', today, { kind: 'date', date: '2026-11-01' }],
    ['mon', today, { kind: 'date', date: '2026-10-05' }],
    ['fri', today, { kind: 'date', date: '2026-10-09' }],
    ['sun', today, { kind: 'date', date: '2026-10-11' }],
    ['next fri', today, { kind: 'date', date: '2026-10-09' }],
    ['2026-10-20', today, { kind: 'date', date: '2026-10-20' }],
    ['10/4', today, { kind: 'date', date: '2026-10-04' }],
    ['3/1', today, { kind: 'date', date: '2027-03-01' }],
    ['20 oct', today, { kind: 'date', date: '2026-10-20' }],
    ['oct 20', today, { kind: 'date', date: '2026-10-20' }],
    ['next mon', wed, { kind: 'date', date: '2026-10-12' }],
    ['next fri', wed, { kind: 'date', date: '2026-10-16' }],
    ['fri', wed, { kind: 'date', date: '2026-10-09' }],
    ['not a when', today, null],
  ].map(([input, day, result]) => ({
    input: input as string,
    today: day as string,
    result,
  }))

  // Recompute from code so the file cannot drift from behaviour.
  for (const c of parseWhenCases) {
    c.result = parseWhen(c.input, localDate(c.today))
  }

  const a = keyBetween(null, null)
  const b = keyBetween(a, null)
  const mid = keyBetween(a, b)
  const batch = keysBetween(a, b, 3)

  let t = 1_000_000_000_000
  const hlc = new Hlc('dev1', () => t)
  const tick1 = hlc.tick()
  const tick2 = hlc.tick() // same wall, counter++
  t = 1_000_000_000_100
  const tick3 = hlc.tick()
  hlc.observe('lfls-0002-other')
  const tick4 = hlc.tick()

  const mergeLocal: MergeE = {
    id: '1',
    title: 'L',
    notes: 'L',
    clock: { id: '1', title: '3', notes: '1' },
  }
  const mergeRemote: MergeE = {
    id: '1',
    title: 'R',
    notes: 'R',
    clock: { id: '1', title: '2', notes: '4' },
  }
  const clearLocal: MergeE = {
    id: '1',
    title: 'x',
    clock: { id: '1', title: '1' },
  }
  const clearRemote: MergeE = { id: '1', clock: { id: '1', title: '2' } }
  const tombEntity: MergeE = {
    id: '1',
    title: 'x',
    clock: { id: '1', title: '5' },
  }

  const rule = (r: Partial<Repeat>): Repeat => ({
    freq: 'day',
    every: 1,
    mode: 'fixed',
    anchor: '2026-10-04',
    ...r,
  })

  /** Successive occurrences from the anchor (same helper as repeat.test.ts). */
  function first(r: Repeat, n: number): string[] {
    const out = [occurrenceOnOrAfter(r, r.anchor)]
    while (out.length < n) out.push(occurrenceAfter(r, out[out.length - 1]!))
    return out
  }

  const templateId = '6b0f3c55-0000-4000-8000-000000000001'
  const instanceDate = '2026-10-04'

  return {
    version: 2,
    parseWhen: parseWhenCases,
    order: {
      keyBetween: [
        { before: null, after: null, result: a },
        { before: a, after: null, result: b },
        { before: a, after: b, result: mid },
      ],
      keysBetween: [{ before: a, after: b, n: 3, result: batch }],
      compare: [
        { a, b, result: compareKeys(a, b) },
        { a: mid, b, result: compareKeys(mid, b) },
      ],
    },
    hlc: {
      device: 'dev1',
      steps: [
        { op: 'tick', now: 1_000_000_000_000, result: tick1 },
        { op: 'tick', now: 1_000_000_000_000, result: tick2 },
        { op: 'tick', now: 1_000_000_000_100, result: tick3 },
        { op: 'observe', stamp: 'lfls-0002-other' },
        { op: 'tick', now: 1_000_000_000_100, result: tick4 },
      ],
    },
    merge: {
      triples: [
        {
          local: mergeLocal,
          remote: mergeRemote,
          result: mergeEntity(mergeLocal, mergeRemote),
        },
        {
          local: clearLocal,
          remote: clearRemote,
          result: mergeEntity(clearLocal, clearRemote),
        },
        {
          local: null,
          remote: mergeRemote,
          result: mergeEntity(undefined, mergeRemote),
        },
      ],
      tombstones: [
        {
          entity: tombEntity,
          tombstone: '6',
          result: resolveTombstone(tombEntity, '6'),
        },
        {
          entity: tombEntity,
          tombstone: '4',
          result: resolveTombstone(tombEntity, '4'),
        },
      ],
      latestStamp: [{ entity: tombEntity, result: latestStamp(tombEntity) }],
    },
    // PLAN §16.1: project headings + inherited tags (fixed ids).
    organisation: (() => {
      const w = new World()
      const areaTag = w.tag({ id: 'tag-area', title: 'Home' })
      const projectTag = w.tag({ id: 'tag-project', title: 'Build' })
      const todoTag = w.tag({ id: 'tag-todo', title: 'Errand' })
      const area = w.area({
        id: 'area-org',
        title: 'House',
        tagIds: [areaTag.id],
      })
      const project = w.project({
        id: 'proj-org',
        title: 'Kitchen',
        areaId: area.id,
        tagIds: [projectTag.id],
      })
      const heading = w.heading({
        id: 'head-prep',
        title: 'Prep',
        projectId: project.id,
        order: 'a0',
      })
      const archived = w.heading({
        id: 'head-old',
        title: 'Old',
        projectId: project.id,
        archived: true,
        order: 'a1',
      })
      const underHeading = w.todo({
        id: 'todo-under-heading',
        title: 'Buy tiles',
        projectId: project.id,
        headingId: heading.id,
        start: 'ready',
        tagIds: [todoTag.id],
      })
      const looseInProject = w.todo({
        id: 'todo-project-loose',
        title: 'Measure bench',
        projectId: project.id,
        start: 'ready',
        tagIds: [],
      })
      // Points at archived heading — projectView keeps it in loose todos.
      w.todo({
        id: 'todo-archived-heading',
        title: 'Legacy note',
        projectId: project.id,
        headingId: archived.id,
        start: 'ready',
      })
      const inboxOnly = w.todo({
        id: 'todo-inbox-tags',
        title: 'Post letter',
        start: 'inbox',
        tagIds: [todoTag.id],
      })
      const ctx: ListContext = { today }
      const view = projectView(w.e, project.id, ctx)!
      const sortedIds = (ids: Iterable<string>) => [...ids].sort()
      return {
        today,
        seed: {
          tags: Object.values(w.e.tags).map((t) => ({
            id: t.id,
            title: t.title,
          })),
          areas: Object.values(w.e.areas).map((a) => ({
            id: a.id,
            title: a.title,
            tagIds: a.tagIds,
            order: a.order,
          })),
          projects: Object.values(w.e.projects).map((p) => ({
            id: p.id,
            title: p.title,
            areaId: p.areaId ?? null,
            tagIds: p.tagIds,
            order: p.order,
          })),
          headings: Object.values(w.e.headings).map((h) => ({
            id: h.id,
            title: h.title,
            projectId: h.projectId,
            archived: h.archived,
            order: h.order,
          })),
          todos: Object.values(w.e.todos).map((t) => ({
            id: t.id,
            title: t.title,
            projectId: t.projectId ?? null,
            headingId: t.headingId ?? null,
            areaId: t.areaId ?? null,
            start: t.start,
            tagIds: t.tagIds,
            order: t.order,
          })),
        },
        projectView: {
          projectId: project.id,
          looseTodoIds: view.todos.map((t) => t.id),
          headings: view.headings.map((g) => ({
            headingId: g.heading.id,
            todoIds: g.todos.map((t) => t.id),
          })),
        },
        effectiveTagIds: [
          {
            todoId: underHeading.id,
            tagIds: sortedIds(effectiveTagIds(w.e, underHeading)),
          },
          {
            todoId: looseInProject.id,
            tagIds: sortedIds(effectiveTagIds(w.e, looseInProject)),
          },
          {
            todoId: inboxOnly.id,
            tagIds: sortedIds(effectiveTagIds(w.e, inboxOnly)),
          },
        ],
      }
    })(),
    // PLAN §16.1: Quick Find known answers (fixed ids). Native rebuilds the
    // same seed and asserts search / homeOf. Merge-trace fixtures still to
    // expand later.
    find: (() => {
      const w = new World()
      const project = w.project({ id: 'proj-garden', title: 'Garden shed' })
      w.todo({
        id: 'todo-timber',
        title: 'Buy timber',
        notes: 'treated pine',
        projectId: project.id,
      })
      const errand = w.tag({ id: 'tag-errand', title: 'Errand' })
      w.todo({
        id: 'todo-parcel',
        title: 'Post parcel',
        tagIds: [errand.id],
      })
      w.todo({ id: 'todo-letter', title: 'Post letter' })
      w.project({
        id: 'proj-trashed',
        title: 'Old plan',
        trashedAt: '2026-10-01T00:00:00Z',
      })
      w.area({
        id: 'area-trashed',
        title: 'Old area',
        trashedAt: '2026-10-01T00:00:00Z',
      })
      const inboxTodo = w.todo({ id: 'todo-find-inbox', title: 'Inbox find' })
      const todayTodo = w.todo({
        id: 'todo-find-today',
        title: 'Today find',
        start: 'ready',
        startDate: today,
      })
      const laterTodo = w.todo({
        id: 'todo-find-later',
        title: 'Later find',
        start: 'later',
      })
      const ctx: ListContext = { today }
      const f = buildFinder(w.e, ctx)
      const top = (query: string) => {
        const hit = f.search(query)[0]
        if (!hit) return null
        return {
          kind: hit.kind,
          path: hit.path,
          todoId: hit.todoId ?? null,
          detail: hit.detail,
        }
      }
      return {
        today,
        seed: {
          tags: Object.values(w.e.tags).map((t) => ({
            id: t.id,
            title: t.title,
          })),
          areas: Object.values(w.e.areas).map((a) => ({
            id: a.id,
            title: a.title,
            order: a.order,
            trashedAt: a.trashedAt ?? null,
          })),
          projects: Object.values(w.e.projects).map((p) => ({
            id: p.id,
            title: p.title,
            areaId: p.areaId ?? null,
            start: p.start,
            startDate: p.startDate ?? null,
            order: p.order,
            trashedAt: p.trashedAt ?? null,
          })),
          todos: Object.values(w.e.todos).map((t) => ({
            id: t.id,
            title: t.title,
            notes: t.notes,
            start: t.start,
            startDate: t.startDate ?? null,
            deadline: t.deadline ?? null,
            tonight: t.tonight,
            status: t.status,
            projectId: t.projectId ?? null,
            areaId: t.areaId ?? null,
            tagIds: t.tagIds,
            order: t.order,
            todayOrder: t.todayOrder ?? null,
            trashedAt: t.trashedAt ?? null,
            completedAt: t.completedAt ?? null,
          })),
        },
        search: [
          { query: 'tod', top: top('tod') },
          { query: 'gard', top: top('gard') },
          { query: 'timbr', top: top('timbr') },
          { query: 'pine', top: top('pine') },
          { query: 'errand', top: top('errand') },
          { query: 'post parcel', top: top('post parcel') },
          { query: 'old', top: top('old') },
          { query: '', top: null },
        ],
        // List-level homes only: project/area home paths differ on native
        // (destination jumps via Find result, not homeOf.list).
        homeOf: [
          {
            todoId: inboxTodo.id,
            path: homeOf(w.e, w.e.todos[inboxTodo.id]!, ctx).path,
          },
          {
            todoId: todayTodo.id,
            path: homeOf(w.e, w.e.todos[todayTodo.id]!, ctx).path,
          },
          {
            todoId: laterTodo.id,
            path: homeOf(w.e, w.e.todos[laterTodo.id]!, ctx).path,
          },
        ],
      }
    })(),
    // PLAN §16.1: list-selector snapshots (fixed ids). Rebuild the same
    // World on native and assert selector outputs.
    lists: (() => {
      const w = new World()
      const area = w.area({ id: 'area-home', title: 'Home' })
      const loose = w.project({ id: 'proj-loose', title: 'Loose' })
      const nested = w.project({
        id: 'proj-kitchen',
        title: 'Kitchen',
        areaId: area.id,
      })
      const laterProj = w.project({
        id: 'proj-later',
        title: 'Someday',
        start: 'later',
      })
      const inboxA = w.todo({ id: 'todo-inbox-a', title: 'Milk' })
      const inboxB = w.todo({ id: 'todo-inbox-b', title: 'Eggs' })
      w.todo({
        id: 'todo-ready-undated',
        title: 'Anytime',
        start: 'ready',
      })
      const todayStarted = w.todo({
        id: 'todo-today',
        title: 'Today chore',
        start: 'ready',
        startDate: today,
        todayOrder: 'a1',
      })
      const overdue = w.todo({
        id: 'todo-overdue',
        title: 'Overdue',
        start: 'ready',
        deadline: '2026-09-30',
        todayOrder: 'a0',
      })
      w.todo({
        id: 'todo-tomorrow',
        title: 'Tomorrow',
        start: 'ready',
        startDate: '2026-10-05',
      })
      w.todo({
        id: 'todo-nov',
        title: 'November',
        start: 'ready',
        startDate: '2026-11-15',
      })
      w.todo({
        id: 'todo-in-project',
        title: 'Paint',
        start: 'ready',
        projectId: nested.id,
      })
      w.todo({
        id: 'todo-later',
        title: 'Not now todo',
        start: 'later',
      })
      w.todo({
        id: 'todo-in-later-proj',
        title: 'Hidden by later project',
        start: 'ready',
        startDate: today,
        projectId: laterProj.id,
      })
      const ctx: ListContext = { today }
      const sched = scheduled(w.e, ctx)
      const later = notNow(w.e, ctx)
      return {
        today,
        seed: {
          areas: Object.values(w.e.areas).map((a) => ({
            id: a.id,
            title: a.title,
            order: a.order,
          })),
          projects: Object.values(w.e.projects).map((p) => ({
            id: p.id,
            title: p.title,
            areaId: p.areaId ?? null,
            start: p.start,
            startDate: p.startDate ?? null,
            order: p.order,
          })),
          todos: Object.values(w.e.todos).map((t) => ({
            id: t.id,
            title: t.title,
            start: t.start,
            startDate: t.startDate ?? null,
            deadline: t.deadline ?? null,
            tonight: t.tonight,
            status: t.status,
            projectId: t.projectId ?? null,
            areaId: t.areaId ?? null,
            order: t.order,
            todayOrder: t.todayOrder ?? null,
            trashedAt: t.trashedAt ?? null,
          })),
        },
        expect: {
          inbox: inbox(w.e, ctx).map((t) => t.id),
          today: todayList(w.e, ctx).map((i) => i.id),
          scheduled: {
            days: sched.days.map((d) => ({
              date: d.date,
              ids: d.items.map((i) => i.id),
            })),
            months: sched.months.map((m) => ({
              month: m.month,
              ids: m.items.map((i) => i.id),
            })),
            waiting: sched.waiting.map((i) => i.id),
          },
          notNow: {
            projects: later.projects.map((p) => p.id),
            todos: later.todos.map((t) => t.id),
          },
          sidebarCounts: sidebarCounts(w.e, ctx),
        },
        // Sanity anchors so a bad World rewrite is obvious in review.
        anchors: {
          inboxA: inboxA.id,
          inboxB: inboxB.id,
          todayStarted: todayStarted.id,
          overdue: overdue.id,
          loose: loose.id,
        },
      }
    })(),
    // PLAN §16.1: repeat sequences + instanceId (31st clamp, 29 Feb, DST,
    // weekly sets, after-completion).
    repeats: {
      instanceId: [
        {
          templateId,
          date: instanceDate,
          result: instanceId(templateId, instanceDate),
        },
      ],
      sequences: [
        {
          name: 'every-3-days',
          rule: rule({ every: 3 }),
          count: 3,
          result: first(rule({ every: 3 }), 3),
        },
        {
          name: 'weekly-mon-thu',
          rule: rule({ freq: 'week', weekdays: [0, 3] }),
          count: 4,
          result: first(rule({ freq: 'week', weekdays: [0, 3] }), 4),
        },
        {
          name: 'fortnightly-monday',
          rule: rule({
            freq: 'week',
            every: 2,
            weekdays: [0],
            anchor: '2026-10-05',
          }),
          count: 3,
          result: first(
            rule({
              freq: 'week',
              every: 2,
              weekdays: [0],
              anchor: '2026-10-05',
            }),
            3,
          ),
        },
        {
          name: 'monthly-31st-clamp',
          rule: rule({ freq: 'month', anchor: '2026-01-31' }),
          count: 4,
          result: first(rule({ freq: 'month', anchor: '2026-01-31' }), 4),
        },
        {
          name: 'yearly-29-feb',
          rule: rule({ freq: 'year', anchor: '2028-02-29' }),
          count: 3,
          result: first(rule({ freq: 'year', anchor: '2028-02-29' }), 3),
        },
        {
          name: 'daily-across-uk-dst',
          rule: rule({ anchor: '2026-10-24' }),
          count: 3,
          result: first(rule({ anchor: '2026-10-24' }), 3),
        },
      ],
      onOrAfter: [
        {
          rule: rule({ every: 3 }),
          from: '2026-10-05',
          result: occurrenceOnOrAfter(rule({ every: 3 }), '2026-10-05'),
        },
      ],
      dueAfterCompletion: [
        {
          rule: rule({ every: 3, mode: 'afterCompletion' }),
          done: '2026-10-04',
          result: dueAfterCompletion(
            rule({ every: 3, mode: 'afterCompletion' }),
            '2026-10-04',
          ),
        },
        {
          rule: rule({ freq: 'month', mode: 'afterCompletion' }),
          done: '2026-01-31',
          result: dueAfterCompletion(
            rule({ freq: 'month', mode: 'afterCompletion' }),
            '2026-01-31',
          ),
        },
      ],
    },
    // PLAN §16.1: full generated-instance JSON after generateRepeats
    // (idempotent today + catch-up keeps only the latest missed fixed date).
    generatedInstances: (() => {
      const templateId = 'tpl-vector-daily'
      const day0 = '2026-10-04'
      const dayCatchUp = '2026-10-11'
      const template: Todo = {
        type: 'todo',
        id: templateId,
        title: 'Water plants',
        notes: 'kitchen',
        status: 'open',
        start: 'ready',
        tonight: false,
        tagIds: [],
        order: 'a0',
        repeat: {
          freq: 'day',
          every: 1,
          mode: 'fixed',
          anchor: day0,
          next: day0,
        },
        createdAt: '2026-10-04T09:00:00.000Z',
        updatedAt: '2026-10-04T09:00:00.000Z',
      }

      const snapInstance = (t: Todo) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        status: t.status,
        start: t.start,
        startDate: t.startDate ?? null,
        tonight: t.tonight,
        order: t.order,
        repeatTemplateId: t.repeatTemplateId ?? null,
        reminderAt: t.reminderAt ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })

      const run = (today: string) => {
        let ms = Date.parse(`${today}T09:00:00.000Z`)
        const clock: Clock = {
          now: () => new Date((ms += 1000)),
          newId: () => 'unused',
          hlc: new Hlc('vec', () => ms),
        }
        const store = createEntityStore(undefined, clock)
        const e = emptyEntities()
        e.todos[templateId] = structuredClone(template)
        store.hydrate(e)
        store.generate((d, env) => generateRepeats(d, env))
        return store
      }

      const afterToday = run(day0)
      // Idempotent second generate on the same day.
      afterToday.generate((d, env) => generateRepeats(d, env))
      const inst0 = afterToday.entities.todos[instanceId(templateId, day0)]!

      // Catch-up: start from a template whose next is still day0 (missed week).
      const afterAway = run(dayCatchUp)
      const dates = Object.values(afterAway.entities.todos)
        .filter((t) => t.repeatTemplateId === templateId)
        .map((t) => t.startDate!)
        .sort()

      return {
        template: {
          id: templateId,
          title: template.title,
          notes: template.notes,
          order: template.order,
          repeat: template.repeat,
        },
        cases: [
          {
            name: 'daily-today-idempotent',
            today: day0,
            expect: {
              instance: snapInstance(inst0),
              templateNext:
                afterToday.entities.todos[templateId]!.repeat!.next!,
              instanceDates: [day0],
            },
          },
          {
            name: 'daily-catch-up-latest-only',
            today: dayCatchUp,
            expect: {
              instanceDates: dates,
              templateNext: afterAway.entities.todos[templateId]!.repeat!.next!,
              latestInstance: snapInstance(
                afterAway.entities.todos[instanceId(templateId, dayCatchUp)]!,
              ),
            },
          },
        ],
      }
    })(),
  }
}

describe('domain vectors', () => {
  it('match docs/shared/domain-vectors.json', () => {
    const vectors = build()
    if (process.env.WRITE_DOMAIN_VECTORS === '1') {
      mkdirSync(path.dirname(FILE), { recursive: true })
      writeFileSync(FILE, `${JSON.stringify(vectors, null, 2)}\n`)
    }
    const committed = JSON.parse(readFileSync(FILE, 'utf8')) as unknown
    expect(committed).toEqual(vectors)
  })
})

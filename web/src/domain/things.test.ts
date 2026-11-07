import { describe, expect, it } from 'vitest'
import { Hlc } from './hlc'
import { createEntityStore, type Clock } from '../store/store'
import * as cmd from '../store/commands'
import { ImportError, parseImport } from './exchange'
import {
  mapThingsToExport,
  parseThingsExport,
  type ThingsExportData,
} from './things'
import { inbox, type ListContext } from './lists'

const ctx: ListContext = { today: '2026-11-07' }

const NOW = new Date(2026, 10, 7, 9)
let n = 0
function clock(): Clock {
  let t = NOW.getTime()
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${++n}`,
    hlc: new Hlc('test', () => t),
  }
}

function sampleThings(): ThingsExportData {
  return {
    format: 'dayrule-things-export',
    version: 1,
    thingsDatabaseVersion: 21,
    exportedAt: '2026-11-07T12:00:00.000Z',
    areas: [{ id: 'area-1', title: 'Personal', order: 0 }],
    tags: [{ id: 'tag-1', title: 'Errand', order: 0 }],
    projects: [
      {
        id: 'proj-1',
        title: 'Kitchen',
        notes: '',
        areaId: 'area-1',
        status: 'open',
        start: 'ready',
        order: 0,
        tagIds: [],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    headings: [
      {
        id: 'head-1',
        projectId: 'proj-1',
        title: 'Morning',
        order: 0,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    todos: [
      {
        id: 'todo-inbox',
        title: 'Buy milk',
        notes: '',
        status: 'open',
        start: 'inbox',
        order: 0,
        tagIds: ['tag-1'],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'todo-sched',
        title: 'Scheduled chore',
        notes: '',
        projectId: 'proj-1',
        headingId: 'head-1',
        status: 'open',
        start: 'ready',
        startDate: '2020-01-01',
        order: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'todo-done',
        title: 'Old completed',
        notes: '',
        status: 'completed',
        start: 'ready',
        order: 2,
        completedAt: '2026-10-01T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'todo-later',
        title: 'Someday read',
        notes: '',
        areaId: 'area-1',
        status: 'open',
        start: 'later',
        order: 3,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'todo-repeat',
        title: 'Daily stretch',
        notes: '',
        status: 'open',
        start: 'ready',
        order: 4,
        repeatTemplate: true,
        repeatNext: '2026-11-08',
        afterCompletion: false,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'todo-weekly',
        title: 'Gym',
        notes: '',
        status: 'open',
        start: 'ready',
        order: 5,
        repeatTemplate: true,
        repeatNext: '2026-11-10',
        afterCompletion: false,
        repeatFreq: 'week',
        repeatEvery: 2,
        repeatWeekdays: [0, 2],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    checklistItems: [
      {
        id: 'check-1',
        todoId: 'todo-sched',
        title: 'Sub-step',
        done: true,
        order: 0,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  }
}

describe('Things import', () => {
  it('parses and maps into Dayrule lists', () => {
    const json = JSON.stringify(sampleThings())
    const data = mapThingsToExport(parseThingsExport(json))
    expect(data.areas).toHaveLength(1)
    expect(
      data.todos.find((t) => t.id === 'todo-repeat')?.repeat,
    ).toMatchObject({
      freq: 'day',
      every: 1,
      mode: 'fixed',
      anchor: '2026-11-08',
    })
    expect(
      data.todos.find((t) => t.id === 'todo-weekly')?.repeat,
    ).toMatchObject({
      freq: 'week',
      every: 2,
      weekdays: [0, 2],
      mode: 'fixed',
      anchor: '2026-11-10',
      next: '2026-11-10',
    })

    const store = createEntityStore(undefined, clock())
    const counts = store.run('Import', (d, env) =>
      cmd.importData(d, env, parseImport(json)),
    )
    expect(counts.todos).toBe(6)
    expect(counts.checklistItems).toBe(1)
    expect(inbox(store.entities, ctx).some((t) => t.title === 'Buy milk')).toBe(
      true,
    )
    expect(
      Object.values(store.entities.todos).some(
        (t) => t.title === 'Someday read' && t.start === 'later',
      ),
    ).toBe(true)
    expect(
      Object.values(store.entities.todos).some(
        (t) => t.title === 'Old completed' && t.status === 'completed',
      ),
    ).toBe(true)
  })

  it('rejects the wrong format version', () => {
    const bad = JSON.stringify({ ...sampleThings(), version: 99 })
    expect(() => parseImport(bad)).toThrow(ImportError)
  })
})

import { describe, expect, it } from 'vitest'
import { Hlc } from './hlc'
import { createEntityStore, type Clock } from '../store/store'
import { generateRepeats, setRepeat } from '../store/repeats'
import * as cmd from '../store/commands'
import {
  exportJson,
  exportMarkdown,
  ImportError,
  parseImport,
} from './exchange'

const NOW = new Date(2026, 9, 4, 9)
let n = 0
function clock(): Clock {
  let t = NOW.getTime()
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${++n}`,
    hlc: new Hlc('test', () => t),
  }
}

/** A small account: an area with a project, a heading, tagged to-dos. */
function sample() {
  const s = createEntityStore(undefined, clock())
  s.run('seed', (d, env) => {
    const area = cmd.createArea(d, env, 'Home')
    const tag = cmd.createTag(d, env, { title: 'Errand' })
    const p = cmd.createProject(d, env, {
      title: 'Garden shed',
      areaId: area.id,
    })
    const h = cmd.createHeading(d, env, p.id, 'Materials')
    const t = cmd.createTodo(d, env, {
      title: 'Buy timber',
      notes: 'treated pine',
      placement: { list: 'project', projectId: p.id, headingId: h.id },
    })
    cmd.setTags(d, env, [t.id], [tag.id])
    cmd.addChecklistItem(d, env, t.id, '2x4s')
    cmd.createTodo(d, env, {
      title: 'Call the plumber',
      placement: { list: 'inbox' },
    })
  })
  return s
}

describe('export and import', () => {
  it('round-trips an account into another, with new ids and the same structure', () => {
    const json = exportJson(sample().entities, NOW)
    expect(json).not.toContain('"clock"')

    const target = createEntityStore(undefined, clock())
    const counts = target.run('Import', (d, env) =>
      cmd.importData(d, env, parseImport(json)),
    )
    expect(counts).toMatchObject({
      areas: 1,
      projects: 1,
      headings: 1,
      todos: 2,
      checklistItems: 1,
      tags: 1,
    })

    const e = target.entities
    const timber = Object.values(e.todos).find((t) => t.title === 'Buy timber')!
    const project = e.projects[timber.projectId!]!
    expect(project.title).toBe('Garden shed')
    expect(e.areas[project.areaId!]?.title).toBe('Home')
    expect(e.headings[timber.headingId!]?.projectId).toBe(project.id)
    expect(timber.tagIds.map((id) => e.tags[id]?.title)).toEqual(['Errand'])
    expect(
      Object.values(e.checklistItems).map((c) => [c.title, c.todoId]),
    ).toEqual([['2x4s', timber.id]])
    expect(timber.notes).toBe('treated pine')

    // One undo removes the whole import.
    target.undo()
    expect(Object.keys(target.entities.todos)).toHaveLength(0)
  })

  it('adds a copy rather than overwriting, even into the same account', () => {
    const s = sample()
    const before = Object.keys(s.entities.todos)
    s.run('Import', (d, env) =>
      cmd.importData(d, env, parseImport(exportJson(s.entities, NOW))),
    )
    const after = Object.keys(s.entities.todos)
    expect(after).toHaveLength(before.length * 2)
    expect(after).toEqual(expect.arrayContaining(before))
  })

  it('drops references to records that are not in the file', () => {
    const data = JSON.parse(exportJson(sample().entities, NOW)) as Record<
      string,
      unknown[]
    >
    data.projects = []
    data.areas = []
    data.tags = []
    const s = createEntityStore(undefined, clock())
    s.run('Import', (d, env) =>
      cmd.importData(d, env, parseImport(JSON.stringify(data))),
    )
    const timber = Object.values(s.entities.todos).find(
      (t) => t.title === 'Buy timber',
    )!
    expect(timber.projectId).toBeUndefined()
    expect(timber.headingId).toBeUndefined()
    expect(timber.tagIds).toEqual([])
    expect(Object.keys(s.entities.headings)).toHaveLength(0)
  })

  it('rejects files that are not valid exports, saying why', () => {
    const ok = JSON.parse(exportJson(sample().entities, NOW)) as Record<
      string,
      unknown
    >
    const bad = (x: unknown) => () =>
      parseImport(typeof x === 'string' ? x : JSON.stringify(x))
    expect(bad('not json')).toThrow(/valid JSON/)
    expect(bad({ hello: 1 })).toThrow(/Dayrule export/)
    expect(bad({ ...ok, version: 99 })).toThrow(/version 99/)
    const todos = ok.todos as Record<string, unknown>[]
    expect(bad({ ...ok, todos: [{ ...todos[0], status: 'maybe' }] })).toThrow(
      /To-do 1: "status"/,
    )
    expect(
      bad({ ...ok, todos: [{ ...todos[0], startDate: '4/10/2026' }] }),
    ).toThrow(/date like/)
    expect(bad({ ...ok, todos: [{ ...todos[0], title: 5 }] })).toThrow(
      ImportError,
    )
  })

  it('writes a readable Markdown outline', () => {
    const md = exportMarkdown(sample().entities, NOW)
    expect(md).toContain('## Home')
    expect(md).toContain('### Garden shed')
    expect(md).toContain('#### Materials')
    expect(md).toContain('- [ ] Buy timber #Errand')
    expect(md).toContain('  > treated pine')
    expect(md).toContain('  - [ ] 2x4s')
    expect(md).toMatch(
      /## Not in a project or area\n\n- \[ \] Call the plumber/,
    )
  })

  it('keeps repeating rules, reminders and the link from instances to templates', () => {
    const s = sample()
    const id = Object.values(s.entities.todos).find(
      (t) => t.title === 'Call the plumber',
    )!.id
    s.run('Remind', (d, env) =>
      cmd.setReminder(d, env, [id], '2026-10-05T09:00'),
    )
    s.run('Repeat', (d, env) =>
      setRepeat(d, env, id, {
        freq: 'week',
        every: 2,
        weekdays: [0, 6],
        mode: 'fixed',
        anchor: '2026-10-04',
      }),
    )
    s.run('Remind', (d, env) =>
      cmd.setReminder(d, env, [id], '2026-10-05T09:00'),
    )
    s.generate((d, env) => generateRepeats(d, env))
    const target = createEntityStore(undefined, clock())
    target.run('Import', (d, env) =>
      cmd.importData(d, env, parseImport(exportJson(s.entities, NOW))),
    )
    const todos = Object.values(target.entities.todos)
    const template = todos.find((t) => t.repeat)!
    expect(template.repeat).toMatchObject({
      freq: 'week',
      every: 2,
      weekdays: [0, 6],
      reminderTime: '09:00',
    })
    const instance = todos.find((t) => t.repeatTemplateId)
    expect(instance?.repeatTemplateId).toBe(template.id)
    expect(instance?.reminderAt).toBe('2026-10-04T09:00')

    const bad = JSON.parse(exportJson(s.entities, NOW)) as {
      todos: Record<string, unknown>[]
    }
    bad.todos = bad.todos.map((t) =>
      t.repeat ? { ...t, repeat: { ...(t.repeat as object), every: 0 } } : t,
    )
    expect(() => parseImport(JSON.stringify(bad))).toThrow(/every/)
  })
})

import { Hlc } from '../domain/hlc'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { inbox, projectView, today, trash } from '../domain/lists'
import * as cmd from './commands'
import type { Entities } from '../domain/types'
import { createEntityStore, type Clock } from './store'

function testClock(start = new Date(2026, 9, 4, 9, 0)): Clock {
  let t = start.getTime()
  let n = 0
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${String(++n).padStart(5, '0')}`,
    hlc: new Hlc('test', () => t),
  }
}

const ctx = { today: '2026-10-04' }

/** Entities without sync clocks: undo restores values, with fresh stamps. */
function values(e: Entities): unknown {
  return JSON.parse(JSON.stringify(e), (k, v: unknown) =>
    k === 'clock' ? undefined : v,
  )
}

describe('store commands', () => {
  it('creates to-dos in the right list', () => {
    const s = createEntityStore(undefined, testClock())
    const a = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'a', placement: { list: 'inbox' } }),
    )
    const b = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'b', placement: { list: 'today' } }),
    )
    const c = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'c', placement: { list: 'later' } }),
    )
    expect(inbox(s.entities, ctx).map((t) => t.id)).toEqual([a.id])
    const t = today(s.entities, ctx)
    expect(t.map((i) => i.id)).toEqual([b.id])
    expect(s.entities.todos[c.id]?.start).toBe('later')
  })

  it('moves an Inbox to-do to Today and appends it to the Today order', () => {
    const s = createEntityStore(undefined, testClock())
    const first = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'today' } }),
    )
    const t = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    s.run('when', (d, env) => cmd.setWhen(d, env, [t.id], { kind: 'today' }))
    expect(today(s.entities, ctx).map((i) => i.id)).toEqual([first.id, t.id])
    expect(inbox(s.entities, ctx)).toEqual([])
  })

  it('completing a project completes its open to-dos', () => {
    const s = createEntityStore(undefined, testClock())
    const p = s.run('p', (d, env) => cmd.createProject(d, env, { title: 'P' }))
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        placement: { list: 'project', projectId: p.id },
      }),
    )
    s.run('done', (d, env) => cmd.setStatus(d, env, [p.id], 'completed'))
    expect(s.entities.todos[t.id]?.status).toBe('completed')
    expect(s.entities.todos[t.id]?.completedAt).toBe(
      s.entities.projects[p.id]?.completedAt,
    )
  })

  it('moving into a project takes a to-do out of the Inbox', () => {
    const s = createEntityStore(undefined, testClock())
    const p = s.run('p', (d, env) => cmd.createProject(d, env, { title: 'P' }))
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    s.run('move', (d, env) =>
      cmd.moveTodos(d, env, [t.id], { kind: 'project', projectId: p.id }),
    )
    expect(inbox(s.entities, ctx)).toEqual([])
    expect(s.entities.todos[t.id]?.start).toBe('ready')
    expect(projectView(s.entities, p.id, ctx)?.todos.map((x) => x.id)).toEqual([
      t.id,
    ])
  })

  it('reorders by rewriting only the moved item', () => {
    const s = createEntityStore(undefined, testClock())
    const [a, b, c] = ['a', 'b', 'c'].map((title) =>
      s.run('new', (d, env) =>
        cmd.createTodo(d, env, { title, placement: { list: 'inbox' } }),
      ),
    )
    const before = s.entities
    s.run('reorder', (d, env) =>
      cmd.reorder(d, env, 'todos', c!.id, 'order', {
        before: a!.id,
        after: b!.id,
      }),
    )
    expect(inbox(s.entities, ctx).map((t) => t.title)).toEqual(['a', 'c', 'b'])
    expect(s.entities.todos[a!.id]).toBe(before.todos[a!.id])
    expect(s.entities.todos[b!.id]).toBe(before.todos[b!.id])
  })

  it('empties the trash, including the contents of trashed projects', () => {
    const s = createEntityStore(undefined, testClock())
    const p = s.run('p', (d, env) => cmd.createProject(d, env, { title: 'P' }))
    const h = s.run('h', (d, env) => cmd.createHeading(d, env, p.id, 'H'))
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        placement: { list: 'project', projectId: p.id, headingId: h.id },
      }),
    )
    const c = s.run('c', (d, env) => cmd.addChecklistItem(d, env, t.id, 'x'))
    s.run('trash', (d, env) => cmd.trashItems(d, env, [p.id]))
    expect(trash(s.entities).items.map((i) => i.id)).toEqual([p.id])

    s.run('empty', (d) => cmd.emptyTrash(d))
    expect(s.entities.projects[p.id]).toBeUndefined()
    expect(s.entities.todos[t.id]).toBeUndefined()
    expect(s.entities.headings[h.id]).toBeUndefined()
    expect(s.entities.checklistItems[c.id]).toBeUndefined()
  })

  it('deleting a tag removes it and its children from tagged items', () => {
    const s = createEntityStore(undefined, testClock())
    const work = s.run('t', (d, env) => cmd.createTag(d, env, { title: 'W' }))
    const calls = s.run('t', (d, env) =>
      cmd.createTag(d, env, { title: 'C', parentId: work.id }),
    )
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    s.run('tag', (d, env) => cmd.setTags(d, env, [t.id], [calls.id]))
    s.run('del', (d, env) => cmd.deleteTag(d, env, work.id))
    expect(s.entities.tags).toEqual({})
    expect(s.entities.todos[t.id]?.tagIds).toEqual([])
  })

  it('does not record a command that changes nothing', () => {
    const s = createEntityStore(undefined, testClock())
    s.run('noop', (d, env) => cmd.setStatus(d, env, ['missing'], 'completed'))
    expect(s.store.getState().past).toEqual([])
  })

  it('converts a to-do with checklist into a project', () => {
    const s = createEntityStore(undefined, testClock())
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'Pack',
        placement: { list: 'today' },
      }),
    )
    s.run('c', (d, env) => cmd.addChecklistItem(d, env, t.id, 'socks'))
    const done = s.run('c', (d, env) =>
      cmd.addChecklistItem(d, env, t.id, 'passport'),
    )
    s.run('tick', (d, env) =>
      cmd.updateChecklistItem(d, env, done.id, { done: true }),
    )
    const p = s.run('convert', (d, env) =>
      cmd.convertTodoToProject(d, env, t.id),
    )
    expect(s.entities.todos[t.id]).toBeUndefined()
    expect(s.entities.projects[p.id]?.title).toBe('Pack')
    expect(s.entities.projects[p.id]?.startDate).toBe('2026-10-04')
    const kids = Object.values(s.entities.todos).filter(
      (x) => x.projectId === p.id,
    )
    expect(kids.map((x) => x.title).sort()).toEqual(['passport', 'socks'])
    expect(kids.find((x) => x.title === 'passport')?.status).toBe('completed')
    expect(kids.find((x) => x.title === 'socks')?.status).toBe('open')
    expect(Object.keys(s.entities.checklistItems)).toEqual([])
  })

  it('converts a project into a to-do with checklist children', () => {
    const s = createEntityStore(undefined, testClock())
    const p = s.run('p', (d, env) =>
      cmd.createProject(d, env, { title: 'Trip' }),
    )
    s.run('h', (d, env) => cmd.createHeading(d, env, p.id, 'Drop me'))
    const a = s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'Book',
        placement: { list: 'project', projectId: p.id },
      }),
    )
    const b = s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'Pack',
        placement: { list: 'project', projectId: p.id },
      }),
    )
    s.run('done', (d, env) => cmd.setStatus(d, env, [b.id], 'completed'))
    const todo = s.run('convert', (d, env) =>
      cmd.convertProjectToTodo(d, env, p.id),
    )
    expect(s.entities.projects[p.id]).toBeUndefined()
    expect(s.entities.todos[a.id]).toBeUndefined()
    expect(s.entities.todos[b.id]).toBeUndefined()
    expect(Object.keys(s.entities.headings)).toEqual([])
    expect(todo.title).toBe('Trip')
    const checks = Object.values(s.entities.checklistItems)
      .filter((c) => c.todoId === todo.id)
      .sort((x, y) => (x.order < y.order ? -1 : 1))
    expect(checks.map((c) => [c.title, c.done])).toEqual([
      ['Book', false],
      ['Pack', true],
    ])
  })
})

describe('undo and redo', () => {
  it('reports labels and notifies change listeners', () => {
    const s = createEntityStore(undefined, testClock())
    const seen: number[] = []
    s.subscribeChanges((changes) => seen.push(changes.length))
    s.run('Add to-do', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    expect(s.undo()).toBe('Add to-do')
    expect(s.redo()).toBe('Add to-do')
    expect(s.undo()).toBe('Add to-do')
    expect(s.undo()).toBeUndefined()
    expect(seen).toEqual([1, 1, 1, 1])
  })

  it('a new command clears the redo stack', () => {
    const s = createEntityStore(undefined, testClock())
    s.run('a', (d, env) => cmd.createArea(d, env, 'A'))
    s.undo()
    s.run('b', (d, env) => cmd.createArea(d, env, 'B'))
    expect(s.redo()).toBeUndefined()
  })

  // Every command must undo back to exactly the prior state.
  const commandArb = fc.oneof(
    fc.record({ op: fc.constant('newInbox' as const), title: fc.string() }),
    fc.record({ op: fc.constant('newToday' as const), title: fc.string() }),
    fc.record({ op: fc.constant('newProject' as const), title: fc.string() }),
    fc.record({ op: fc.constant('newArea' as const), title: fc.string() }),
    fc.record({ op: fc.constant('complete' as const), pick: fc.nat() }),
    fc.record({ op: fc.constant('reopen' as const), pick: fc.nat() }),
    fc.record({
      op: fc.constant('when' as const),
      pick: fc.nat(),
      kind: fc.constantFrom(
        'today' as const,
        'later' as const,
        'ready' as const,
        'clear' as const,
      ),
    }),
    fc.record({
      op: fc.constant('moveToProject' as const),
      pick: fc.nat(),
      to: fc.nat(),
    }),
    fc.record({ op: fc.constant('trash' as const), pick: fc.nat() }),
    fc.record({ op: fc.constant('restore' as const), pick: fc.nat() }),
    fc.record({ op: fc.constant('emptyTrash' as const) }),
    fc.record({
      op: fc.constant('logMode' as const),
      mode: fc.constantFrom(
        'immediately' as const,
        'daily' as const,
        'manually' as const,
      ),
    }),
  )

  it('undoing everything restores the initial state exactly', () => {
    fc.assert(
      fc.property(fc.array(commandArb, { maxLength: 40 }), (ops) => {
        const s = createEntityStore(undefined, testClock())
        const initial = s.entities
        const snapshots = [initial]

        for (const o of ops) {
          const e = s.entities
          const items = [
            ...Object.keys(e.todos),
            ...Object.keys(e.projects),
          ].sort()
          const projects = Object.keys(e.projects).sort()
          const pick = (n: number, xs: string[]) =>
            xs[n % Math.max(xs.length, 1)]
          const before = s.store.getState().past.length

          s.run(o.op, (d, env) => {
            switch (o.op) {
              case 'newInbox':
                return cmd.createTodo(d, env, {
                  title: o.title,
                  placement: { list: 'inbox' },
                })
              case 'newToday':
                return cmd.createTodo(d, env, {
                  title: o.title,
                  placement: { list: 'today' },
                })
              case 'newProject':
                return cmd.createProject(d, env, { title: o.title })
              case 'newArea':
                return cmd.createArea(d, env, o.title)
              case 'complete':
              case 'reopen': {
                const id = pick(o.pick, items)
                return (
                  id &&
                  cmd.setStatus(
                    d,
                    env,
                    [id],
                    o.op === 'complete' ? 'completed' : 'open',
                  )
                )
              }
              case 'when': {
                const id = pick(o.pick, items)
                return id && cmd.setWhen(d, env, [id], { kind: o.kind })
              }
              case 'moveToProject': {
                const id = pick(o.pick, Object.keys(e.todos).sort())
                const to = pick(o.to, projects)
                return (
                  id &&
                  to &&
                  cmd.moveTodos(d, env, [id], {
                    kind: 'project',
                    projectId: to,
                  })
                )
              }
              case 'trash':
              case 'restore': {
                const id = pick(o.pick, items)
                if (!id) return
                return o.op === 'trash'
                  ? cmd.trashItems(d, env, [id])
                  : cmd.restoreItems(d, env, [id])
              }
              case 'emptyTrash':
                return cmd.emptyTrash(d)
              case 'logMode':
                return cmd.setDoneMode(d, o.mode)
            }
          })
          if (s.store.getState().past.length > before)
            snapshots.push(s.entities)
        }

        // Step back through every recorded command.
        for (let i = snapshots.length - 1; i > 0; i--) {
          expect(values(s.entities)).toEqual(values(snapshots[i]!))
          s.undo()
        }
        expect(values(s.entities)).toEqual(values(initial))

        // And forward again.
        for (let i = 1; i < snapshots.length; i++) {
          s.redo()
          expect(values(s.entities)).toEqual(values(snapshots[i]!))
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('sync clocks', () => {
  it('stamps changed fields, keeps unchanged ones, and re-stamps on undo', () => {
    const s = createEntityStore(undefined, testClock())
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, { title: 'a', placement: { list: 'inbox' } }),
    )
    const created = s.entities.todos[t.id]!.clock!
    expect(Object.keys(created)).toEqual(
      expect.arrayContaining(['title', 'notes', 'status']),
    )
    s.run('edit', (d, env) => cmd.updateTodo(d, env, t.id, { title: 'b' }))
    const edited = s.entities.todos[t.id]!.clock!
    expect(edited.title! > created.title!).toBe(true)
    expect(edited.notes).toBe(created.notes)
    s.undo()
    const undone = s.entities.todos[t.id]!
    expect(undone.title).toBe('a')
    expect(undone.clock!.title! > edited.title!).toBe(true)
  })

  it('applies remote changes without undo and tells listeners they are remote', () => {
    const s = createEntityStore(undefined, testClock())
    const seen: string[] = []
    s.subscribeChanges((_c, meta) => seen.push(meta.source))
    s.applyRemote(
      [
        {
          kind: 'entity',
          collection: 'tags',
          id: 'x',
          after: {
            type: 'tag',
            id: 'x',
            title: 'Remote',
            order: 'a0',
            createdAt: '',
            updatedAt: '',
            clock: { title: 'zzzzzzzzz-0000-other' },
          },
        },
      ],
      'sync',
    )
    expect(s.entities.tags.x?.title).toBe('Remote')
    expect(s.store.getState().past).toEqual([])
    expect(seen).toEqual(['sync'])
    // The local clock moved past the remote stamp.
    expect(s.tick() > 'zzzzzzzzz-0000-other').toBe(true)
  })
})

describe('undo with synced edits', () => {
  it('reverts only the fields the step changed', () => {
    const s = createEntityStore(undefined, testClock())
    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, { title: 'a', placement: { list: 'inbox' } }),
    )
    s.run('edit', (d, env) => cmd.updateTodo(d, env, t.id, { title: 'b' }))
    // Another device edits the notes meanwhile.
    const cur = s.entities.todos[t.id]!
    s.applyRemote(
      [
        {
          kind: 'entity',
          collection: 'todos',
          id: t.id,
          before: cur,
          after: { ...cur, notes: 'remote' },
        },
      ],
      'sync',
    )
    s.undo()
    expect(s.entities.todos[t.id]).toMatchObject({
      title: 'a',
      notes: 'remote',
    })
    s.redo()
    expect(s.entities.todos[t.id]).toMatchObject({
      title: 'b',
      notes: 'remote',
    })
  })
})

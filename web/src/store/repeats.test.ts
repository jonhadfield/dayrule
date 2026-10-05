import { describe, expect, it } from 'vitest'
import { Hlc } from '../domain/hlc'
import { scheduled, today } from '../domain/lists'
import { mergeEntity } from '../domain/merge'
import type { Repeat, Todo } from '../domain/types'
import * as cmd from './commands'
import { generateRepeats, instanceId, setRepeat } from './repeats'
import { createEntityStore, GENERATED, type Clock } from './store'

/** A store whose clock can be moved to a given day. */
function device(name: string) {
  let t = new Date(2026, 9, 4, 9).getTime()
  let n = 0
  const clock: Clock = {
    now: () => new Date((t += 1000)),
    newId: () => `${name}-${++n}`,
    hlc: new Hlc(name, () => t),
  }
  const s = createEntityStore(undefined, clock)
  return {
    s,
    goTo: (y: number, m: number, d: number) =>
      (t = new Date(y, m - 1, d, 9).getTime()),
    generate: () => s.generate((d, env) => generateRepeats(d, env)),
    ctx: () => ({ today: new Date(t).toISOString().slice(0, 10) }),
  }
}

const daily: Omit<Repeat, 'next'> = {
  freq: 'day',
  every: 1,
  mode: 'fixed',
  anchor: '2026-10-04',
}

function repeating(
  dev: ReturnType<typeof device>,
  rule = daily,
  title = 'Water plants',
) {
  const t = dev.s.run('t', (d, env) =>
    cmd.createTodo(d, env, { title, placement: { list: 'inbox' } }),
  )
  dev.s.run('Repeat', (d, env) => setRepeat(d, env, t.id, rule))
  return t.id
}

const instances = (dev: ReturnType<typeof device>, templateId: string) =>
  Object.values(dev.s.entities.todos)
    .filter((t) => t.repeatTemplateId === templateId)
    .map((t) => t.startDate)
    .sort()

describe('repeating to-dos', () => {
  it('hides the template, creates today’s instance, and is idempotent', () => {
    const dev = device('a')
    const id = repeating(dev)
    expect(today(dev.s.entities, dev.ctx())).toEqual([]) // template hidden
    dev.generate()
    dev.generate()
    expect(instances(dev, id)).toEqual(['2026-10-04'])
    expect(today(dev.s.entities, dev.ctx()).map((i) => i.title)).toEqual([
      'Water plants',
    ])
    expect(dev.s.entities.todos[id]?.repeat?.next).toBe('2026-10-05')
    // The template shows in Scheduled at its next date.
    const tomorrow = scheduled(dev.s.entities, dev.ctx()).days[0]!
    expect(tomorrow.items.map((i) => i.id)).toEqual([id])
  })

  it('after time away, creates only the latest missed occurrence', () => {
    const dev = device('a')
    const id = repeating(dev)
    dev.generate()
    dev.goTo(2026, 10, 11)
    dev.generate()
    expect(instances(dev, id)).toEqual(['2026-10-04', '2026-10-11'])
    expect(dev.s.entities.todos[id]?.repeat?.next).toBe('2026-10-12')
  })

  it('after completion: the next one is due N days after the last is done', () => {
    const dev = device('a')
    const id = repeating(dev, { ...daily, every: 3, mode: 'afterCompletion' })
    dev.generate()
    expect(dev.s.entities.todos[id]?.repeat?.next).toBeUndefined()
    dev.goTo(2026, 10, 9)
    dev.generate()
    expect(instances(dev, id)).toEqual(['2026-10-04']) // waits for completion
    const first = instanceId(id, '2026-10-04')
    dev.s.run('Complete', (d, env) =>
      cmd.setStatus(d, env, [first], 'completed'),
    )
    expect(dev.s.entities.todos[id]?.repeat?.next).toBe('2026-10-12')
    dev.goTo(2026, 10, 12)
    dev.generate()
    expect(instances(dev, id)).toEqual(['2026-10-04', '2026-10-12'])
  })

  it('copies the checklist, unticked', () => {
    const dev = device('a')
    const t = dev.s.run('t', (d, env) =>
      cmd.createTodo(d, env, { title: 'Pack', placement: { list: 'inbox' } }),
    )
    dev.s.run('c', (d, env) => cmd.addChecklistItem(d, env, t.id, 'Passport'))
    dev.s.run('Repeat', (d, env) => setRepeat(d, env, t.id, daily))
    dev.generate()
    const inst = instanceId(t.id, '2026-10-04')
    const items = Object.values(dev.s.entities.checklistItems).filter(
      (c) => c.todoId === inst,
    )
    expect(items.map((c) => [c.title, c.done])).toEqual([['Passport', false]])
  })

  it('two devices make identical instances, and any real change beats them', () => {
    const a = device('a')
    const id = repeating(a)
    // Device b has the same template (synced) and generates offline too.
    const b = device('b')
    b.s.hydrate(structuredClone(a.s.entities))
    a.generate()
    b.generate()
    const inst = instanceId(id, '2026-10-04')
    const fromA = a.s.entities.todos[inst]!
    const fromB = b.s.entities.todos[inst]!
    expect(fromB).toEqual(fromA)
    expect(Object.values(fromA.clock ?? {}).every((s) => s === GENERATED)).toBe(
      true,
    )

    // a completes it; b's untouched generated copy arrives later: completion wins.
    a.s.run('Complete', (d, env) => cmd.setStatus(d, env, [inst], 'completed'))
    const merged = mergeEntity<Todo>(a.s.entities.todos[inst], fromB)
    expect(merged.status).toBe('completed')
  })

  it('a deleted instance is not made again', () => {
    const dev = device('a')
    const id = repeating(dev)
    dev.generate()
    const inst = instanceId(id, '2026-10-04')
    dev.s.run('Delete', (d) => d.remove('todos', inst))
    dev.generate()
    expect(dev.s.entities.todos[inst]).toBeUndefined()
  })

  it('stopping removes the template and keeps its instances; undo brings it back', () => {
    const dev = device('a')
    const id = repeating(dev)
    dev.generate()
    dev.s.run('Stop', (d, env) => setRepeat(d, env, id, null))
    expect(dev.s.entities.todos[id]).toBeUndefined()
    expect(instances(dev, id)).toEqual(['2026-10-04'])
    dev.s.undo()
    expect(dev.s.entities.todos[id]?.repeat).toBeDefined()
  })

  it('generation adds nothing to undo', () => {
    const dev = device('a')
    repeating(dev)
    const before = dev.s.store.getState().past.length
    dev.generate()
    expect(dev.s.store.getState().past.length).toBe(before)
  })

  it('gives each instance the template’s reminder time', () => {
    const dev = device('a')
    const id = repeating(dev)
    dev.s.run('Remind', (d, env) =>
      cmd.setReminder(d, env, [id], '2026-10-04T08:30'),
    )
    expect(dev.s.entities.todos[id]?.repeat?.reminderTime).toBe('08:30')
    dev.generate()
    expect(dev.s.entities.todos[instanceId(id, '2026-10-04')]?.reminderAt).toBe(
      '2026-10-04T08:30',
    )
  })
})

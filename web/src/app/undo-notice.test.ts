import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hlc } from '../domain/hlc'
import type { Change } from '../store/draft'
import * as cmd from '../store/commands'
import { createEntityStore, type Clock } from '../store/store'
import { dismissNotice, useNotice } from './notice'
import { attachUndoNotices, undoMessage } from './undo-notice'

function testClock(start = new Date(2026, 9, 4, 9, 0)): Clock {
  let t = start.getTime()
  let n = 0
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${String(++n).padStart(5, '0')}`,
    hlc: new Hlc('test', () => t),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  dismissNotice()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('undoMessage', () => {
  it('names the to-do for Complete and Trash', () => {
    const changes = [
      {
        kind: 'entity' as const,
        collection: 'todos' as const,
        id: 'a',
        after: { title: 'Milk' },
      },
    ] as Change[]
    expect(undoMessage('Complete', changes)).toBe('Completed Milk')
    expect(undoMessage('Move to Trash', changes)).toBe('Moved Milk to Trash')
    expect(undoMessage('Edit', changes)).toBeUndefined()
  })
})

describe('attachUndoNotices', () => {
  it('posts Completed, undoes while the stack is still that depth, and skips later edits', () => {
    const s = createEntityStore(undefined, testClock())
    const stop = attachUndoNotices(s)
    const todo = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'Milk', placement: { list: 'inbox' } }),
    )
    expect(useNotice.getState().current).toBeNull()

    s.run('Complete', (d, env) => cmd.setStatus(d, env, [todo.id], 'completed'))
    expect(useNotice.getState().current).toMatchObject({
      kind: 'undo',
      message: 'Completed Milk',
      actionTitle: 'Undo',
    })
    expect(s.entities.todos[todo.id]?.status).toBe('completed')

    useNotice.getState().current?.action?.()
    expect(s.entities.todos[todo.id]?.status).toBe('open')
    expect(useNotice.getState().current).toBeNull()

    s.run('Complete', (d, env) => cmd.setStatus(d, env, [todo.id], 'completed'))
    const depth = s.store.getState().past.length
    s.run('edit', (d, env) =>
      cmd.updateTodo(d, env, todo.id, { title: 'Oat milk' }),
    )
    expect(useNotice.getState().current).toBeNull()
    expect(s.store.getState().past.length).toBe(depth + 1)
    stop()
  })

  it('does not undo if another command landed on the stack first', () => {
    const s = createEntityStore(undefined, testClock())
    attachUndoNotices(s)
    const todo = s.run('new', (d, env) =>
      cmd.createTodo(d, env, { title: 'Milk', placement: { list: 'inbox' } }),
    )
    s.run('Complete', (d, env) => cmd.setStatus(d, env, [todo.id], 'completed'))
    const undo = useNotice.getState().current?.action
    s.run('edit', (d, env) =>
      cmd.updateTodo(d, env, todo.id, { notes: '2 pints' }),
    )
    undo?.()
    expect(s.entities.todos[todo.id]?.status).toBe('completed')
    expect(s.entities.todos[todo.id]?.notes).toBe('2 pints')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '../../app/ui-state'
import { Hlc } from '../../domain/hlc'
import * as cmd from '../../store/commands'
import { createEntityStore } from '../../store/store'
import { closeEditor, startNewTodo } from './editing'

function store() {
  let t = new Date(2026, 9, 4, 9).getTime()
  let n = 0
  return createEntityStore(undefined, {
    now: () => new Date((t += 1000)),
    newId: () => `id-${++n}`,
    hlc: new Hlc('test', () => t),
  })
}

beforeEach(() => {
  useUI.setState({ editingId: null, draftId: null, selectedIds: [] })
  // jsdom has no matchMedia; behave like desktop.
  window.matchMedia = ((q: string) => ({
    matches: true,
    media: q,
  })) as unknown as typeof window.matchMedia
})

describe('closing a new to-do', () => {
  it('throws away an empty one even after a date was picked (Scheduled)', () => {
    const s = store()
    s.run('Keep', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'Existing',
        placement: { list: 'inbox' },
      }),
    )
    startNewTodo(s, { list: 'ready' }, { kind: 'date', date: '2026-10-06' })
    const id = useUI.getState().editingId!
    s.run('When', (d, env) =>
      cmd.setWhen(d, env, [id], { kind: 'date', date: '2026-10-08' }),
    )
    closeEditor(s)
    expect(s.entities.todos[id]).toBeUndefined()
    expect(Object.values(s.entities.todos).map((t) => t.title)).toEqual([
      'Existing',
    ])
    // Nothing of it is left to undo or redo.
    expect(s.store.getState().past.map((e) => e.label)).toEqual(['Keep'])
    expect(s.store.getState().future).toEqual([])
  })

  it('keeps one that has a title', () => {
    const s = store()
    startNewTodo(s, { list: 'inbox' })
    const id = useUI.getState().editingId!
    s.run('Title', (d, env) => cmd.updateTodo(d, env, id, { title: 'Real' }))
    closeEditor(s)
    expect(s.entities.todos[id]?.title).toBe('Real')
  })

  it('throws away an empty one with an emptied checklist', () => {
    const s = store()
    startNewTodo(s, { list: 'inbox' })
    const id = useUI.getState().editingId!
    const item = s.run('Checklist', (d, env) =>
      cmd.addChecklistItem(d, env, id, ''),
    )
    s.run('Remove', (d) => cmd.removeChecklistItem(d, item.id))
    closeEditor(s)
    expect(s.entities.todos[id]).toBeUndefined()
    expect(s.store.getState().past).toEqual([])
  })
})

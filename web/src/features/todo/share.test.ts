import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from '../../app/ui-state'
import { Hlc } from '../../domain/hlc'
import { createEntityStore } from '../../store/store'
import { fieldsFromShareParams, startSharedTodo } from './share'

describe('fieldsFromShareParams', () => {
  it('returns null when nothing was shared', () => {
    expect(fieldsFromShareParams(new URLSearchParams())).toBeNull()
  })

  it('uses title and puts text and url in notes', () => {
    expect(
      fieldsFromShareParams(
        new URLSearchParams({
          title: 'Article',
          text: 'A short blurb',
          url: 'https://example.com/a',
        }),
      ),
    ).toEqual({
      title: 'Article',
      notes: 'A short blurb\n\nhttps://example.com/a',
    })
  })

  it('takes the first line of text as the title when title is empty', () => {
    expect(
      fieldsFromShareParams(
        new URLSearchParams({
          text: 'Buy milk\n2 litres',
          url: 'https://shop.example/milk',
        }),
      ),
    ).toEqual({
      title: 'Buy milk',
      notes: '2 litres\n\nhttps://shop.example/milk',
    })
  })

  it('uses a lone url as the title', () => {
    expect(
      fieldsFromShareParams(
        new URLSearchParams({ url: 'https://example.com' }),
      ),
    ).toEqual({ title: 'https://example.com', notes: '' })
  })
})

describe('startSharedTodo', () => {
  beforeEach(() => {
    useUI.setState({ editingId: null, draftId: null, selectedIds: [] })
  })

  it('creates an Inbox to-do and opens the editor', () => {
    let t = new Date(2026, 9, 4, 9).getTime()
    let n = 0
    const store = createEntityStore(undefined, {
      now: () => new Date((t += 1000)),
      newId: () => `id-${++n}`,
      hlc: new Hlc('test', () => t),
    })
    startSharedTodo(store, {
      title: 'Shared page',
      notes: 'https://example.com',
    })
    const id = useUI.getState().editingId!
    expect(store.entities.todos[id]).toMatchObject({
      title: 'Shared page',
      notes: 'https://example.com',
      start: 'inbox',
      status: 'open',
    })
  })
})

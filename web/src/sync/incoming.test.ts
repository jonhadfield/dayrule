import { describe, expect, it } from 'vitest'
import { emptyEntities } from '../domain/types'
import { incomingChanges, sameJSON } from './incoming'

describe('incoming records', () => {
  it('compares JSON regardless of key order', () => {
    expect(
      sameJSON({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }),
    ).toBe(true)
    expect(sameJSON({ a: 1, x: undefined }, { a: 1 })).toBe(true)
    expect(sameJSON({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  })

  it('a merged copy that equals the incoming one is not pushed back', () => {
    const e = emptyEntities()
    const tag = {
      type: 'tag',
      id: 't',
      title: 'x',
      order: 'a0',
      createdAt: '',
      updatedAt: '',
      clock: { title: '2' },
    }
    e.tags.t = { ...tag, title: 'old', clock: { title: '1' } } as never
    const { changes, pushBack } = incomingChanges(e, [
      { key: 'tags/t', value: tag },
    ])
    expect(changes).toHaveLength(1)
    expect(pushBack).toEqual([])
  })

  it('a locally newer field is applied and pushed back', () => {
    const e = emptyEntities()
    e.tags.t = {
      type: 'tag',
      id: 't',
      title: 'mine',
      order: 'a0',
      createdAt: '',
      updatedAt: '',
      clock: { title: '9' },
    } as never
    const theirs = {
      type: 'tag',
      id: 't',
      title: 'theirs',
      order: 'b0',
      createdAt: '',
      updatedAt: '',
      clock: { title: '1', order: '5' },
    }
    const { changes, pushBack } = incomingChanges(e, [
      { key: 'tags/t', value: theirs },
    ])
    expect(changes[0]).toMatchObject({ after: { title: 'mine', order: 'b0' } })
    expect(pushBack).toEqual(['tags/t'])
  })

  it('ignores a version older than a local deletion, and pushes the deletion', () => {
    const value = {
      type: 'tag',
      id: 't',
      title: 'x',
      order: 'a0',
      createdAt: '',
      updatedAt: '',
      clock: { title: '3' },
    }
    const { changes, pushBack } = incomingChanges(
      emptyEntities(),
      [{ key: 'tags/t', value }],
      new Map([['tags/t', '4']]),
    )
    expect(changes).toEqual([])
    expect(pushBack).toEqual(['tags/t'])
  })
})

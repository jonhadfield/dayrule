import { describe, expect, it } from 'vitest'
import type { DoneDay } from '../../domain/lists'
import type { Todo } from '../../domain/types'
import {
  doneRowOffsets,
  flattenDoneDays,
  todoIdsFromDoneRows,
  windowForScroll,
} from './doneVirtual'

function todo(id: string, completedAt: string): Todo {
  return {
    type: 'todo',
    id,
    createdAt: completedAt,
    updatedAt: completedAt,
    title: id,
    notes: '',
    status: 'completed',
    completedAt,
    start: 'inbox',
    tonight: false,
    tagIds: [],
    order: id,
  }
}

describe('flattenDoneDays', () => {
  it('interleaves headings and items, newest days first as given', () => {
    const days: DoneDay[] = [
      { date: '2026-11-08', items: [todo('a', '2026-11-08T10:00:00Z')] },
      {
        date: '2026-11-07',
        items: [
          todo('b', '2026-11-07T12:00:00Z'),
          todo('c', '2026-11-07T09:00:00Z'),
        ],
      },
    ]
    const rows = flattenDoneDays(days)
    expect(rows.map((r) => r.key)).toEqual([
      'h:2026-11-08',
      't:a',
      'h:2026-11-07',
      't:b',
      't:c',
    ])
    expect(todoIdsFromDoneRows(rows)).toEqual(['a', 'b', 'c'])
  })
})

describe('windowForScroll', () => {
  it('returns a window around the viewport with overscan', () => {
    const rows = flattenDoneDays([
      {
        date: '2026-11-08',
        items: Array.from({ length: 40 }, (_, i) =>
          todo(`t${i}`, '2026-11-08T10:00:00Z'),
        ),
      },
    ])
    const { offsets } = doneRowOffsets(rows, 40)
    // Skip heading (44px), then rows of 40px. Viewport 200px at scroll 500.
    const { start, end } = windowForScroll(500, 200, offsets, 2)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(end - start).toBeLessThan(rows.length)
    expect(end - start).toBeGreaterThan(4)
  })
})

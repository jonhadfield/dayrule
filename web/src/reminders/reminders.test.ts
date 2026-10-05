import { describe, expect, it } from 'vitest'
import { World } from '../domain/fixtures'
import { upcoming } from './reminders'

describe('upcoming reminders', () => {
  it('includes only open, untrashed, non-template to-dos with a reminder still to come', () => {
    const w = new World()
    const now = new Date(2026, 9, 4, 12, 0)
    const due = w.todo({ title: 'Later today', reminderAt: '2026-10-04T14:00' })
    w.todo({ title: 'Already past', reminderAt: '2026-10-04T11:59' })
    w.todo({
      title: 'Done',
      reminderAt: '2026-10-05T09:00',
      status: 'completed',
    })
    w.todo({
      title: 'Trashed',
      reminderAt: '2026-10-05T09:00',
      trashedAt: '2026-10-04T00:00:00Z',
    })
    w.todo({ title: 'No reminder' })
    const tomorrow = w.todo({
      title: 'Tomorrow',
      reminderAt: '2026-10-05T09:00',
    })
    expect(upcoming(w.e, now).map((r) => r.todoId)).toEqual([
      due.id,
      tomorrow.id,
    ])
  })
})

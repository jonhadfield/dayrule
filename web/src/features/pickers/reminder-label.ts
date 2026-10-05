import { formatDisplayDate } from '../../domain/dates'
import type { Todo } from '../../domain/types'

/** "Today 14:00", "2026/10/12 09:30", or a repeat's "09:30". */
export function reminderLabel(todo: Todo, today: string): string | undefined {
  if (todo.repeat) return todo.repeat.reminderTime
  if (!todo.reminderAt) return undefined
  const date = todo.reminderAt.slice(0, 10)
  const time = todo.reminderAt.slice(11, 16)
  return `${date === today ? 'Today' : formatDisplayDate(date)} ${time}`
}

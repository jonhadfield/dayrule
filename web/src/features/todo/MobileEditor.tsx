import { useEntities } from '../../app/context'
import { useUI } from '../../app/ui-state'
import { TodoEditor } from './TodoEditor'

/**
 * The full-screen editor on mobile. It lives outside the list, so it stays
 * open when an edit (say, scheduling for a later date) moves the to-do out of
 * the list it was opened from.
 */
export function MobileEditor() {
  const id = useUI((s) => s.editingId)
  const todo = useEntities((e) => (id ? e.todos[id] : undefined))
  if (!todo) return null
  return <TodoEditor key={todo.id} todo={todo} fullScreen />
}

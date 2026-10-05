import { useUI } from '../../app/ui-state'
import type { EntityStore, Entry } from '../../store/store'
import * as cmd from '../../store/commands'

export const newTodoLabel = (id: string) => `New To-Do ${id}`

/** Create a to-do and open it for editing as a discardable draft. */
export function startNewTodo(
  store: EntityStore,
  placement: cmd.Placement,
  when?: cmd.When,
): void {
  const id = store.run<string>(
    (todoId: string) => newTodoLabel(todoId),
    (d, env) => {
      const t = cmd.createTodo(d, env, { placement })
      if (when) cmd.setWhen(d, env, [t.id], when)
      return t.id
    },
  )
  useUI.getState().edit(id, { draft: true })
}

/** Close the editor. An untouched new to-do is discarded. */
export function closeEditor(store: EntityStore): void {
  const ui = useUI.getState()
  const id = ui.editingId
  if (!id) return
  const todo = store.entities.todos[id]
  const hasChecklist = Object.values(store.entities.checklistItems).some(
    (c) => c.todoId === id,
  )
  const empty =
    todo &&
    todo.title.trim() === '' &&
    todo.notes.trim() === '' &&
    !hasChecklist
  if (ui.draftId === id && empty) {
    // Throw it away, with any edits made to it meanwhile (say, a date
    // picked in Scheduled): they leave nothing behind, not even in undo.
    const onlyThis = (e: Entry) =>
      e.changes.every((c) => {
        if (c.kind !== 'entity') return false
        if (c.collection === 'todos') return c.id === id
        const item = (c.before ?? c.after) as { todoId?: string } | undefined
        return c.collection === 'checklistItems' && item?.todoId === id
      })
    const retracted = store.retract(
      onlyThis,
      (e) => e.label === newTodoLabel(id),
    )
    if (!retracted) store.run('Discard', (d) => d.remove('todos', id))
    ui.select(null)
  }
  ui.edit(null)
  // On touch layouts a row is never 'selected' without its editor open.
  if (!window.matchMedia('(min-width: 900px)').matches) ui.select(null)
}

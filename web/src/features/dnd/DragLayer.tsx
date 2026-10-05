import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useState, type ReactNode } from 'react'
import { useEntityStore } from '../../app/context'
import { useUI } from '../../app/ui-state'
import * as cmd from '../../store/commands'
import type { Draft } from '../../store/draft'
import { newTodoLabel } from '../todo/editing'
import type { DragData, DropAction, DropData, Group } from './types'

// Sidebar targets win when the pointer is over them; otherwise the
// nearest row, so dropping between rows feels natural.
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  const sidebar = within.filter(
    (c) =>
      (c.data?.droppableContainer.data.current as DropData | undefined)
        ?.type === 'sidebar',
  )
  if (sidebar.length) return sidebar
  return closestCenter(args)
}

function applyDrop(d: Draft, env: cmd.Env, ids: string[], action: DropAction) {
  if (action.kind === 'move') cmd.moveTodos(d, env, ids, action.target)
  else if (action.kind === 'when') cmd.setWhen(d, env, ids, action.when)
  else if (action.kind === 'complete') cmd.setStatus(d, env, ids, 'completed')
  else cmd.trashItems(d, env, ids)
}

/**
 * Drag and drop for the whole app (PLAN.md §8.1). Keyboard reordering is
 * ⌘↑/⌘↓ (useGlobalKeys), so rows keep their list semantics.
 */
export function DragLayer({ children }: { children: ReactNode }) {
  const store = useEntityStore()
  const [active, setActive] = useState<{
    data: DragData
    count: number
  } | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to pick up on touch, so swiping still scrolls.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  )

  const draggedIds = (id: string) => {
    const { selectedIds } = useUI.getState()
    return selectedIds.includes(id) ? selectedIds : [id]
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined
    if (!data) return
    useUI.getState().edit(null)
    setActive({
      data,
      count: data.type === 'todo' ? draggedIds(data.id).length : 1,
    })
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const from = e.active.data.current as
      (DragData & { sortable?: { items: string[] } }) | undefined
    const to = e.over?.data.current as
      (DropData & { sortable?: { items: string[] } }) | undefined
    if (!from) return
    const { orderField } = useUI.getState()

    if (from.type === 'add') {
      dropNewTodo(to)
      return
    }
    if (!to) return
    const ids = draggedIds(from.id)

    if (to.type === 'sidebar') {
      store.run(`Drop on ${to.label}`, (d, env) =>
        applyDrop(d, env, ids, to.action),
      )
      useUI.getState().select(null)
      return
    }

    const targetGroup: Group = to.group
    const sameGroup = targetGroup.id === from.group.id

    if (to.type === 'todo' && sameGroup) {
      if (to.id === from.id) return
      const items = from.sortable?.items ?? []
      const moved = arrayMove(
        items,
        items.indexOf(from.id),
        items.indexOf(to.id),
      )
      const i = moved.indexOf(from.id)
      store.run('Reorder', (d, env) =>
        cmd.reorder(d, env, 'todos', from.id, orderField, {
          before: moved[i - 1],
          after: moved[i + 1],
        }),
      )
      return
    }

    if (!sameGroup && targetGroup.drop) {
      const drop = targetGroup.drop
      store.run('Move', (d, env) => {
        applyDrop(d, env, ids, drop)
        // Land just above the row it was dropped on.
        if (to.type === 'todo') {
          const items = to.sortable?.items ?? []
          // Chain them so several dropped to-dos keep their own order.
          let previous = items[items.indexOf(to.id) - 1]
          for (const id of ids) {
            cmd.reorder(d, env, 'todos', id, orderField, {
              before: previous,
              after: to.id,
            })
            previous = id
          }
        }
      })
    }
  }

  /** The Add button dropped into a list: a new to-do at that position. */
  const dropNewTodo = (
    to: (DropData & { sortable?: { items: string[] } }) | undefined,
  ) => {
    const ui = useUI.getState()
    const group = to && to.type !== 'sidebar' ? to.group : undefined
    const placement = group?.place ?? ui.placement
    if (!placement) return
    const id = store.run<string>(
      (todoId: string) => newTodoLabel(todoId),
      (d, env) => {
        const t = cmd.createTodo(d, env, { placement })
        if (to?.type === 'todo') {
          const items = to.sortable?.items ?? []
          const at = items.indexOf(to.id)
          cmd.reorder(d, env, 'todos', t.id, ui.orderField, {
            before: items[at - 1],
            after: to.id,
          })
        }
        return t.id
      },
    )
    ui.edit(id, { draft: true })
  }

  const label =
    active?.data.type === 'add'
      ? 'New to-do'
      : active && active.count > 1
        ? `${active.count} to-dos`
        : active?.data.type === 'todo'
          ? store.entities.todos[active.data.id]?.title || 'Untitled'
          : ''

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="pointer-events-none inline-flex max-w-xs items-center gap-2 rounded-full bg-text px-4 py-1.5 text-sm text-bg shadow-lg">
            <span className="truncate">{label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

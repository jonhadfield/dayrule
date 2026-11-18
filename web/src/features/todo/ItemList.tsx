import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Item, ListContext } from '../../domain/lists'
import type { Todo } from '../../domain/types'
import type { DragData, Group } from '../dnd/types'
import { ProjectRow } from './ProjectRow'
import { TodoRow, type DragHandle } from './TodoRow'

interface Props {
  items: Item[]
  ctx: ListContext
  showContainer?: boolean
  showStartDate?: boolean
  showTodayMeta?: boolean
  /** Makes the to-dos sortable within this group and a drop target. */
  group?: Group
}

export function ItemList({
  items,
  ctx,
  showContainer,
  showStartDate,
  showTodayMeta,
  group,
}: Props) {
  const rowProps = {
    ...(showContainer !== undefined ? { showContainer } : {}),
    ...(showStartDate !== undefined ? { showStartDate } : {}),
    ...(showTodayMeta !== undefined ? { showTodayMeta } : {}),
  }
  if (!group) {
    if (items.length === 0) return null
    return (
      <ul className="flex flex-col">
        {items.map((i) =>
          i.type === 'project' ? (
            <ProjectRow key={i.id} project={i} />
          ) : (
            <TodoRow key={i.id} todo={i} ctx={ctx} {...rowProps} />
          ),
        )}
      </ul>
    )
  }
  return (
    <SortableList items={items} ctx={ctx} group={group} rowProps={rowProps} />
  )
}

function SortableList({
  items,
  ctx,
  group,
  rowProps,
}: {
  items: Item[]
  ctx: ListContext
  group: Group
  rowProps: {
    showContainer?: boolean
    showStartDate?: boolean
    showTodayMeta?: boolean
  }
}) {
  const todoIds = items.filter((i) => i.type === 'todo').map((i) => i.id)
  const { setNodeRef, isOver } = useDroppable({
    id: `group:${group.id}`,
    data: { type: 'group', group },
  })
  return (
    <SortableContext
      id={group.id}
      items={todoIds}
      strategy={verticalListSortingStrategy}
    >
      <ul
        ref={setNodeRef}
        className={`flex flex-col ${items.length === 0 ? 'min-h-3' : ''} ${isOver && items.length === 0 ? 'bg-accent/10' : ''}`}
      >
        {items.map((i) =>
          i.type === 'project' ? (
            <ProjectRow key={i.id} project={i} />
          ) : (
            <SortableTodo
              key={i.id}
              todo={i}
              ctx={ctx}
              group={group}
              {...rowProps}
            />
          ),
        )}
      </ul>
    </SortableContext>
  )
}

function SortableTodo({
  todo,
  ctx,
  group,
  ...rowProps
}: {
  todo: Todo
  ctx: ListContext
  group: Group
  showContainer?: boolean
  showStartDate?: boolean
  showTodayMeta?: boolean
}) {
  const data: DragData = { type: 'todo', id: todo.id, group }
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({
      id: todo.id,
      data,
    })
  const drag: DragHandle = {
    ref: setNodeRef,
    listeners,
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  }
  return <TodoRow todo={todo} ctx={ctx} drag={drag} {...rowProps} />
}

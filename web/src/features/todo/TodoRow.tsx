import {
  Bell,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Flag,
  ListChecks,
  Repeat2,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useAllEntities, useEntityStore, useIsDesktop } from '../../app/context'
import { useUI, visibleTodoIds } from '../../app/ui-state'
import {
  formatDisplayDate,
  addLocalDays,
  fromLocalDate,
} from '../../domain/dates'
import type { ListContext } from '../../domain/lists'
import type { Todo } from '../../domain/types'
import * as cmd from '../../store/commands'
import { Checkbox } from '../../ui/Checkbox'
import { RowLeading } from '../../ui/RowLeading'
import { TodoEditor } from './TodoEditor'
import { RowMenu } from './RowMenu'
import { useRowSwipe } from './useRowSwipe'

function deadlineLabel(deadline: string, today: string): string {
  if (deadline === today) return 'today'
  if (deadline < today) return `${formatDisplayDate(deadline)} (overdue)`
  if (deadline === addLocalDays(today, 1)) return 'tomorrow'
  return formatDisplayDate(deadline)
}

/** Day-granularity past-date chip (Today trailing). */
function daysPastLabel(
  anchor: string,
  today: string,
  word: 'overdue' | 'late',
) {
  const ms = fromLocalDate(today).getTime() - fromLocalDate(anchor).getTime()
  const days = Math.max(1, Math.round(ms / 86_400_000))
  const n = days === 1 ? '1d' : `${days}d`
  return `${n} ${word}`
}

/** Drag wiring from a sortable list (see ItemList). */
export interface DragHandle {
  ref: (el: HTMLElement | null) => void
  listeners: Record<string, unknown> | undefined
  style: CSSProperties
  isDragging: boolean
}

interface Props {
  drag?: DragHandle
  todo: Todo
  ctx: ListContext
  /** Show the project or area it belongs to (lists that mix containers). */
  showContainer?: boolean
  /** Show the start date (Done and Trash show other dates instead). */
  showStartDate?: boolean
  /** Today list: trailing Today / overdue chip (native parity). */
  showTodayMeta?: boolean
}

export function TodoRow({
  drag,
  todo,
  ctx,
  showContainer = true,
  showStartDate = false,
  showTodayMeta = false,
}: Props) {
  const store = useEntityStore()
  const e = useAllEntities()
  const isDesktop = useIsDesktop()
  const selected = useUI((s) => s.selectedIds.includes(todo.id))
  const editing = useUI((s) => s.editingId === todo.id)
  const leaving = useUI((s) => s.lingering[todo.id] === 'leaving')
  // Mobile: swipe right to schedule, left to start selecting (PLAN.md §6).
  const swipe = useRowSwipe({
    onRight: () => useUI.getState().openPanel('when', [todo.id]),
    onLeft: () => useUI.getState().startSelecting(todo.id),
  })

  if (editing && isDesktop) return <TodoEditor todo={todo} />

  const checklist = Object.values(e.checklistItems).filter(
    (c) => c.todoId === todo.id,
  )
  const container = todo.projectId
    ? e.projects[todo.projectId]
    : todo.areaId
      ? e.areas[todo.areaId]
      : undefined
  const done = todo.status !== 'open'
  const overdueDeadline =
    !done && todo.deadline !== undefined && todo.deadline < ctx.today
  const overdueWhen =
    !done &&
    !overdueDeadline &&
    todo.startDate !== undefined &&
    todo.startDate < ctx.today

  const toggle = () =>
    store.run(done ? 'Reopen' : 'Complete', (d, env) =>
      cmd.setStatus(d, env, [todo.id], done ? 'open' : 'completed'),
    )

  const row = (
    <li
      ref={drag?.ref}
      style={drag?.style}
      {...(drag?.listeners ?? {})}
      className={[
        'relative cursor-default touch-pan-y touch-pinch-zoom overflow-hidden border-b border-hairline',
        drag?.isDragging ? 'opacity-40' : '',
        leaving ? 'row-leave' : '',
      ].join(' ')}
      data-todo-id={todo.id}
      onClick={(ev) => {
        const ui = useUI.getState()
        if (!isDesktop) {
          if (swipe.consumeClick()) return
          if (ui.selecting) return ui.toggle(todo.id)
          return ui.edit(todo.id)
        }
        if (ev.metaKey || ev.ctrlKey) return ui.toggle(todo.id)
        if (ev.shiftKey) return ui.extendTo(todo.id, visibleTodoIds())
        ui.select(todo.id)
      }}
      onDoubleClick={() => isDesktop && useUI.getState().edit(todo.id)}
      // List items can't carry aria-selected; screen readers hear "Selected".
      data-selected={selected || undefined}
      {...(isDesktop ? {} : swipe.handlers)}
    >
      {swipe.dx !== 0 && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center px-4 text-sm font-medium text-bg ${swipe.dx > 0 ? 'justify-start bg-scheduled' : 'justify-end bg-accent'} ${swipe.committed ? '' : 'opacity-70'}`}
        >
          {swipe.dx > 0 ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays size={16} /> When
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Select <CircleCheck size={16} />
            </span>
          )}
        </div>
      )}
      <div
        className={`relative flex min-h-[var(--row-height)] items-center gap-[var(--row-glyph-spacing)] bg-bg ${selected ? '' : 'hover:bg-sidebar/60'} ${swipe.dx === 0 ? 'transition-transform duration-150' : ''}`}
        style={
          swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined
        }
      >
        {selected && <span className="sr-only">Selected</span>}
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-accent/10"
          />
        )}
        <RowLeading>
          <Checkbox
            status={todo.status}
            onToggle={toggle}
            label={`Complete ${todo.title || 'to-do'}`}
          />
        </RowLeading>
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-center gap-2">
            {showStartDate && todo.startDate && (
              <span className="shrink-0 rounded bg-sidebar px-1 text-xs text-text-secondary">
                {formatDisplayDate(todo.startDate)}
              </span>
            )}
            <span
              data-todo-title
              className={`truncate ${done ? 'text-text-secondary line-through' : ''} ${todo.title ? '' : 'text-text-secondary'}`}
            >
              {todo.title || 'Untitled'}
            </span>
            {todo.reminderAt && todo.status === 'open' && (
              <Bell
                size={13}
                className="shrink-0 text-text-secondary"
                aria-label="Has a reminder"
              />
            )}
            {(todo.repeat || todo.repeatTemplateId) && (
              <Repeat2
                size={13}
                className="shrink-0 text-text-secondary"
                aria-label="Repeating"
              />
            )}
            {todo.repeat?.next && showStartDate && (
              <span className="shrink-0 rounded bg-sidebar px-1 text-xs text-text-secondary">
                {formatDisplayDate(todo.repeat.next)}
              </span>
            )}
            {todo.notes.trim() !== '' && (
              <FileText
                size={13}
                className="shrink-0 text-text-secondary"
                aria-label="Has notes"
              />
            )}
            {checklist.length > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-xs text-text-secondary">
                <ListChecks size={13} aria-hidden />
                {checklist.filter((c) => c.done).length}/{checklist.length}
              </span>
            )}
          </div>
          {showContainer && container && (
            <div className="truncate text-xs text-text-secondary">
              {container.title || 'Untitled'}
            </div>
          )}
        </div>
        {todo.tagIds.map((id) =>
          e.tags[id] ? (
            <span
              key={id}
              className="hidden shrink-0 rounded-full border border-hairline px-2 text-xs text-text-secondary sm:inline"
            >
              {e.tags[id]?.title}
            </span>
          ) : null,
        )}
        {showTodayMeta && !done ? (
          overdueDeadline && todo.deadline ? (
            // Flag matches other lists + the sidebar overdue badge (deadlines only).
            <span
              aria-hidden
              title="Deadline overdue"
              className="flex shrink-0 items-center gap-1 text-xs text-deadline"
            >
              <Flag size={12} aria-hidden />
              {daysPastLabel(todo.deadline, ctx.today, 'overdue')}
            </span>
          ) : overdueWhen && todo.startDate ? (
            <span
              aria-hidden
              title="When is past"
              className="flex shrink-0 items-center gap-1 text-xs text-deadline"
            >
              <Clock size={12} aria-hidden />
              {daysPastLabel(todo.startDate, ctx.today, 'late')}
            </span>
          ) : (
            <span
              aria-hidden
              className="flex shrink-0 items-center gap-1 text-xs text-text-secondary"
            >
              <CalendarDays size={12} aria-hidden />
              Today
            </span>
          )
        ) : (
          todo.deadline && (
            <span
              className={`flex shrink-0 items-center gap-1 text-xs ${todo.deadline <= ctx.today && !done ? 'text-deadline' : 'text-text-secondary'}`}
            >
              <Flag size={12} aria-hidden />
              {deadlineLabel(todo.deadline, ctx.today)}
            </span>
          )
        )}
      </div>
    </li>
  )
  // Right-click menu on desktop; on touch a long press is for dragging.
  return isDesktop ? <RowMenu todoId={todo.id}>{row}</RowMenu> : row
}

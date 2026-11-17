import {
  ArrowRightLeft,
  Bell,
  CalendarDays,
  Flag,
  ListChecks,
  Hourglass,
  Repeat2,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAllEntities, useEntityStore, useToday } from '../../app/context'
import { formatDisplayDate } from '../../domain/dates'
import { compareKeys } from '../../domain/order'
import type { Todo } from '../../domain/types'
import * as cmd from '../../store/commands'
import { Checkbox } from '../../ui/Checkbox'
import { RowLeading } from '../../ui/RowLeading'
import { DeadlinePicker } from '../pickers/DeadlinePicker'
import { MovePicker } from '../pickers/MovePicker'
import { TagPicker } from '../pickers/TagPicker'
import { WhenPicker } from '../pickers/WhenPicker'
import { RepeatPicker } from '../pickers/RepeatPicker'
import { ReminderPicker } from '../pickers/ReminderPicker'
import { reminderLabel } from '../pickers/reminder-label'
import { describeRepeat } from '../../domain/repeat'
import { useUI } from '../../app/ui-state'
import { closeEditor } from './editing'

function whenLabel(
  todo: Todo,
  today: string,
): { icon: ReactNode; text: string } | null {
  if (todo.start === 'later') {
    return {
      icon: <Hourglass size={14} className="text-later" />,
      text: 'Not now',
    }
  }
  if (!todo.startDate) return null
  if (todo.startDate <= today) {
    return { icon: <Sun size={14} className="text-today" />, text: 'Today' }
  }
  return {
    icon: <CalendarDays size={14} className="text-scheduled" />,
    text: formatDisplayDate(todo.startDate),
  }
}

const toolButton =
  'flex items-center gap-1 rounded-[6px] px-2 py-1 text-sm text-text-secondary hover:bg-sidebar hover:text-text'

export function TodoEditor({
  todo,
  fullScreen = false,
}: {
  todo: Todo
  fullScreen?: boolean
}) {
  const store = useEntityStore()
  const e = useAllEntities()
  // The template whose rule the Repeat button edits: this to-do if it is
  // one, else the template it was made from.
  const template = todo.repeat
    ? todo
    : todo.repeatTemplateId
      ? e.todos[todo.repeatTemplateId]
      : undefined
  const today = useToday()
  const cardRef = useRef<HTMLDivElement>(null)

  // Click outside closes the inline editor, but not clicks in popovers.
  useEffect(() => {
    if (fullScreen) return
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Node
      if (cardRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper]'))
        return
      closeEditor(store)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [fullScreen, store])

  const checklist = Object.values(e.checklistItems)
    .filter((c) => c.todoId === todo.id)
    .sort((a, b) => compareKeys(a.order, b.order))
  const when = whenLabel(todo, today)

  const update = (patch: { title?: string; notes?: string }) =>
    store.run('Edit', (d, env) => cmd.updateTodo(d, env, todo.id, patch))

  const card = (
    <div
      ref={cardRef}
      className={
        fullScreen
          ? 'editor-sheet fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg px-4 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),12px)]'
          : 'editor-in my-2 rounded-[6px] border border-hairline border-l-[3px] border-l-accent bg-sidebar/40 p-3'
      }
      role="dialog"
      aria-label="Edit to-do"
    >
      {fullScreen && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={() => closeEditor(store)}
          >
            Done
          </button>
        </div>
      )}
      <div className="flex items-start gap-[var(--row-glyph-spacing)]">
        <div className="pt-1">
          <RowLeading>
            <Checkbox
              status={todo.status}
              label="Complete"
              onToggle={() =>
                store.run('Complete', (d, env) =>
                  cmd.setStatus(
                    d,
                    env,
                    [todo.id],
                    todo.status === 'open' ? 'completed' : 'open',
                  ),
                )
              }
            />
          </RowLeading>
        </div>
        <div className="min-w-0 flex-1">
          <input
            // Opening a to-do (click, Enter) puts you in it, keyboard or not.
            autoFocus
            value={todo.title}
            placeholder="What needs doing?"
            aria-label="Title"
            enterKeyHint="done"
            onChange={(ev) => update({ title: ev.target.value })}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault()
                closeEditor(store)
              }
            }}
            className="w-full bg-transparent text-[17px] outline-none"
          />
          <textarea
            value={todo.notes}
            placeholder="Notes"
            aria-label="Notes"
            rows={Math.max(2, todo.notes.split('\n').length)}
            onChange={(ev) => update({ notes: ev.target.value })}
            className="mt-1 w-full resize-none bg-transparent text-text-secondary outline-none"
          />

          {checklist.length > 0 && (
            <ul className="mt-1 border-t border-hairline">
              {checklist.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 border-b border-hairline py-1"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={c.done}
                    aria-label={`Done: ${c.title}`}
                    className={`size-3.5 shrink-0 rounded-full border ${c.done ? 'border-accent bg-accent' : 'border-text-secondary'}`}
                    onClick={() =>
                      store.run('Checklist', (d, env) =>
                        cmd.updateChecklistItem(d, env, c.id, {
                          done: !c.done,
                        }),
                      )
                    }
                  />
                  <input
                    value={c.title}
                    aria-label="Checklist item"
                    onChange={(ev) =>
                      store.run('Checklist', (d, env) =>
                        cmd.updateChecklistItem(d, env, c.id, {
                          title: ev.target.value,
                        }),
                      )
                    }
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault()
                        store.run('Checklist', (d, env) =>
                          cmd.addChecklistItem(d, env, todo.id, ''),
                        )
                      }
                      if (ev.key === 'Backspace' && c.title === '') {
                        ev.preventDefault()
                        store.run('Checklist', (d) =>
                          cmd.removeChecklistItem(d, c.id),
                        )
                      }
                    }}
                    autoFocus={c.title === ''}
                    className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${c.done ? 'text-text-secondary line-through' : ''}`}
                  />
                  <button
                    type="button"
                    aria-label="Remove checklist item"
                    className="text-text-secondary hover:text-text"
                    onClick={() =>
                      store.run('Checklist', (d) =>
                        cmd.removeChecklistItem(d, c.id),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {/* A template has a rule, not a date or deadline (§4.2). */}
            {!todo.repeat && (
              <WhenPicker
                ids={[todo.id]}
                trigger={
                  <button type="button" className={toolButton}>
                    {when?.icon ?? <CalendarDays size={14} />}
                    {when?.text ?? 'When'}
                  </button>
                }
              />
            )}
            <RepeatPicker
              templateId={template?.id ?? todo.id}
              current={template?.repeat}
              defaultAnchor={todo.startDate}
              trigger={
                <button type="button" className={toolButton}>
                  <Repeat2 size={14} />
                  {template?.repeat
                    ? `${describeRepeat(template.repeat)}${template.repeat.next ? ` · next ${formatDisplayDate(template.repeat.next)}` : ''}`
                    : 'Repeat'}
                </button>
              }
            />
            <ReminderPicker
              todo={todo}
              trigger={
                <button
                  type="button"
                  className={`${toolButton} ${reminderLabel(todo, today) ? 'text-text' : ''}`}
                >
                  <Bell size={14} />
                  {reminderLabel(todo, today) ?? 'Reminder'}
                </button>
              }
            />
            <TagPicker
              itemId={todo.id}
              current={todo.tagIds}
              trigger={
                <button type="button" className={toolButton}>
                  <Tag size={14} />
                  {todo.tagIds.length > 0
                    ? todo.tagIds
                        .map((id) => e.tags[id]?.title)
                        .filter(Boolean)
                        .join(', ')
                    : 'Tags'}
                </button>
              }
            />
            <button
              type="button"
              className={toolButton}
              onClick={() =>
                store.run('Checklist', (d, env) =>
                  cmd.addChecklistItem(d, env, todo.id, ''),
                )
              }
            >
              <ListChecks size={14} />
              Checklist
            </button>
            {!todo.repeat && (
              <DeadlinePicker
                ids={[todo.id]}
                trigger={
                  <button
                    type="button"
                    className={`${toolButton} ${todo.deadline ? 'text-deadline' : ''}`}
                  >
                    <Flag size={14} />
                    {todo.deadline
                      ? formatDisplayDate(todo.deadline)
                      : 'Deadline'}
                  </button>
                }
              />
            )}
            <MovePicker
              ids={[todo.id]}
              trigger={
                <button type="button" className={toolButton}>
                  <ArrowRightLeft size={14} />
                  Move
                </button>
              }
            />
            <button
              type="button"
              className={`${toolButton} ml-auto`}
              aria-label="Move to Trash"
              onClick={() => {
                store.run('Trash', (d, env) =>
                  cmd.trashItems(d, env, [todo.id]),
                )
                useUI.getState().edit(null)
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return fullScreen ? card : <li className="list-none">{card}</li>
}

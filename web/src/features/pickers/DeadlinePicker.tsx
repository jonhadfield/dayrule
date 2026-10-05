import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useEntities, useEntityStore, useToday } from '../../app/context'
import { formatDisplayDate, fromLocalDate, parseWhen } from '../../domain/dates'
import * as cmd from '../../store/commands'
import { Calendar } from '../../ui/Calendar'
import { Popover } from '../../ui/Popover'
import { useInSheet } from '../../ui/sheet-context'

export function DeadlinePanel({
  ids,
  onDone,
}: {
  ids: string[]
  onDone: () => void
}) {
  const inSheet = useInSheet()
  const store = useEntityStore()
  const today = useToday()
  const [text, setText] = useState('')
  const parsed = parseWhen(text, fromLocalDate(today))
  const current = useEntities((e) => {
    const first = ids[0] ? (e.todos[ids[0]] ?? e.projects[ids[0]]) : undefined
    return first?.deadline
  })
  const date =
    parsed?.kind === 'date'
      ? parsed.date
      : parsed?.kind === 'today'
        ? today
        : null

  const apply = (deadline: string | undefined) => {
    store.run('Deadline', (d, env) => cmd.setDeadline(d, env, ids, deadline))
    setText('')
    onDone()
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (date) apply(date)
        }}
      >
        <input
          autoFocus={!inSheet}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Deadline: fri, 10/31, 2026/11/15"
          aria-label="Deadline"
          className="mb-1 w-full rounded-[6px] border border-hairline bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        {text !== '' && (
          <p className="px-2 pb-1 text-sm text-text-secondary" role="status">
            {date ? `↵ ${formatDisplayDate(date)}` : 'Not a date I understand'}
          </p>
        )}
      </form>
      <Calendar today={today} selected={current} onSelect={(d) => apply(d)} />
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-sidebar"
        onClick={() => apply(undefined)}
      >
        <X size={16} className="text-text-secondary" />
        Remove deadline
      </button>
    </>
  )
}

/** Deadline panel in a popover, opened from a button. */
export function DeadlinePicker({
  ids,
  trigger,
}: {
  ids: string[]
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      title="Deadline"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
    >
      <DeadlinePanel ids={ids} onDone={() => setOpen(false)} />
    </Popover>
  )
}

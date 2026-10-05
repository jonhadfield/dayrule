import { Hourglass, ListTodo, Sun, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useEntities, useEntityStore, useToday } from '../../app/context'
import { formatDisplayDate, fromLocalDate, parseWhen } from '../../domain/dates'
import * as cmd from '../../store/commands'
import { Calendar } from '../../ui/Calendar'
import { Popover } from '../../ui/Popover'
import { useInSheet } from '../../ui/sheet-context'

interface Props {
  ids: string[]
  onDone: () => void
}

function describe(r: ReturnType<typeof parseWhen>): string {
  if (!r) return ''
  if (r.kind === 'date') return formatDisplayDate(r.date)
  return { today: 'Today', later: 'Not now' }[r.kind]
}

export function WhenPanel({ ids, onDone }: Props) {
  const inSheet = useInSheet()
  const store = useEntityStore()
  const today = useToday()
  const [text, setText] = useState('')
  const parsed = parseWhen(text, fromLocalDate(today))
  const selectedDate = useEntities((e) => {
    const first = ids[0] ? (e.todos[ids[0]] ?? e.projects[ids[0]]) : undefined
    return first?.startDate
  })

  const apply = (when: cmd.When) => {
    store.run('When', (d, env) => cmd.setWhen(d, env, ids, when))
    setText('')
    onDone()
  }

  const option = (icon: ReactNode, label: string, when: cmd.When) => (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-sidebar"
      onClick={() => apply(when)}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (parsed) apply(parsed)
        }}
      >
        <input
          autoFocus={!inSheet}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="When: tom, fri, 10/20, in 3 days"
          aria-label="When"
          className="mb-1 w-full rounded-[6px] border border-hairline bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        {text !== '' && (
          <p className="px-2 pb-1 text-sm text-text-secondary" role="status">
            {parsed ? `↵ ${describe(parsed)}` : 'Not a date I understand'}
          </p>
        )}
      </form>
      {option(<Sun size={16} className="text-today" />, 'Today', {
        kind: 'today',
      })}
      {option(<ListTodo size={16} className="text-ready" />, 'Backlog', {
        kind: 'ready',
      })}
      {option(<Hourglass size={16} className="text-later" />, 'Not now', {
        kind: 'later',
      })}
      {option(<X size={16} className="text-text-secondary" />, 'Clear', {
        kind: 'clear',
      })}
      <div className="mt-1 border-t border-hairline pt-2">
        <Calendar
          today={today}
          selected={selectedDate}
          min={today}
          onSelect={(date) => apply({ kind: 'date', date })}
        />
      </div>
    </>
  )
}

/** When panel in a popover, opened from a button. */
export function WhenPicker({
  ids,
  trigger,
}: {
  ids: string[]
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover title="When" open={open} onOpenChange={setOpen} trigger={trigger}>
      <WhenPanel ids={ids} onDone={() => setOpen(false)} />
    </Popover>
  )
}

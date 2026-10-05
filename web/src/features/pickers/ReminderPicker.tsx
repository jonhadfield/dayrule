import { useState, type ReactNode } from 'react'
import { useEntityStore, useToday } from '../../app/context'
import type { Todo } from '../../domain/types'
import * as cmd from '../../store/commands'
import { Calendar } from '../../ui/Calendar'
import { Popover } from '../../ui/Popover'

function ReminderPanel({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const store = useEntityStore()
  const today = useToday()
  const repeating = todo.repeat !== undefined
  const [date, setDate] = useState(
    todo.reminderAt?.slice(0, 10) ?? todo.startDate ?? today,
  )
  const [time, setTime] = useState(
    (repeating ? todo.repeat?.reminderTime : todo.reminderAt?.slice(11, 16)) ??
      '09:00',
  )
  const set = (at: string | null) => {
    store.run(at ? 'Reminder' : 'Clear Reminder', (d, env) =>
      cmd.setReminder(d, env, [todo.id], at),
    )
    onDone()
  }
  const has = repeating
    ? todo.repeat?.reminderTime !== undefined
    : todo.reminderAt !== undefined

  return (
    <div className="flex flex-col gap-3 p-1 text-sm">
      {repeating ? (
        <p className="text-text-secondary">Each repeat is reminded at:</p>
      ) : (
        <Calendar
          today={today}
          selected={date}
          min={today}
          onSelect={setDate}
        />
      )}
      <label className="flex items-center gap-2">
        Time
        <input
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="rounded-[6px] border border-hairline bg-transparent px-2 py-1"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!/^\d\d:\d\d$/.test(time)}
          onClick={() => set(`${repeating ? today : date}T${time}`)}
          className="rounded-full bg-text px-4 py-1.5 font-medium text-bg hover:bg-accent disabled:opacity-50"
        >
          Remind me
        </button>
        {has && (
          <button
            type="button"
            onClick={() => set(null)}
            className="text-text-secondary hover:text-deadline"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-text-secondary">
        Reminders need turning on in Account → Reminders. Dayrule’s server
        learns when a reminder is due, never what it’s for.
      </p>
    </div>
  )
}

export function ReminderPicker({
  todo,
  trigger,
}: {
  todo: Todo
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      title="Reminder"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
    >
      <ReminderPanel todo={todo} onDone={() => setOpen(false)} />
    </Popover>
  )
}

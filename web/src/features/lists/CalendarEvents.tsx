import { useCalendarOverlay } from '../../calendar/overlay'
import type { CalendarEvent } from '../../domain/ics'

/** Read-only calendar rows (not to-dos; no complete / drag). */
export function CalendarEventRows({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null
  return (
    <ul className="mb-2">
      {events.map((ev) => (
        <li
          key={ev.uid}
          className="flex min-h-[var(--row-height)] items-center gap-2 border-b border-hairline px-1 text-[15px] text-text-secondary"
        >
          <span
            className="w-10 shrink-0 text-xs tabular-nums"
            title="Calendar"
          >
            {ev.time ?? 'all day'}
          </span>
          <span className="min-w-0 flex-1 truncate text-text">{ev.title}</span>
        </li>
      ))}
    </ul>
  )
}

export function TodayCalendarEvents({ today }: { today: string }) {
  // Select the stable array; filter in render so Zustand doesn’t see a new
  // reference every time (which re-renders forever).
  const all = useCalendarOverlay((s) => s.events)
  return <CalendarEventRows events={all.filter((e) => e.date === today)} />
}

export function ScheduledCalendarEvents({ date }: { date: string }) {
  const all = useCalendarOverlay((s) => s.events)
  return <CalendarEventRows events={all.filter((e) => e.date === date)} />
}

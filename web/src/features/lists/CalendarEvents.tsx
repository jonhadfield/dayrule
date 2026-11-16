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
          className="flex min-h-[var(--row-height)] items-center gap-3 border-b border-hairline px-1 text-[15px]"
        >
          {/* Same width as the to-do checkbox so titles line up. */}
          <span
            className="grid size-[20px] shrink-0 place-items-center text-[10px] text-text-secondary"
            title="Calendar"
            aria-hidden
          >
            ·
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
            <span className="truncate text-text">{ev.title}</span>
            <span className="shrink-0 text-xs text-text-secondary">
              {ev.time ?? 'all day'}
            </span>
          </div>
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

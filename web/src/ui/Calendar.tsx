import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  addMonths,
  formatMonth,
  monthGrid,
  monthOf,
  sameDayInMonth,
} from '../domain/calendar'
import { addLocalDays } from '../domain/dates'
import type { LocalDate } from '../domain/types'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface Props {
  today: LocalDate
  selected?: LocalDate | undefined
  /** Days before this are shown but can't be picked. */
  min?: LocalDate
  onSelect: (date: LocalDate) => void
}

/**
 * Year/month/day calendar with Monday-first weeks (decision 9). Replaces
 * the browser's date input, whose format follows the system locale.
 * Arrow keys move by day/week, PageUp/PageDown by month, Enter picks.
 */
export function Calendar({ today, selected, min, onSelect }: Props) {
  const [focus, setFocus] = useState<LocalDate>(selected ?? today)
  const [month, setMonth] = useState<LocalDate>(monthOf(selected ?? today))
  const gridRef = useRef<HTMLDivElement>(null)

  // Keyboard moves keep real focus on the focused day (roving tabindex).
  useEffect(() => {
    const grid = gridRef.current
    if (!grid?.contains(document.activeElement)) return
    grid.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus()
  }, [focus, month])

  const moveFocus = (date: LocalDate) => {
    setFocus(date)
    setMonth(monthOf(date))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (e.key in step) {
      e.preventDefault()
      moveFocus(addLocalDays(focus, step[e.key] ?? 0))
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const m = addMonths(monthOf(focus), e.key === 'PageUp' ? -1 : 1)
      moveFocus(sameDayInMonth(m, focus))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!min || focus >= min) onSelect(focus)
    }
  }

  return (
    <div className="select-none" onKeyDown={onKeyDown}>
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          type="button"
          aria-label="Previous month"
          className="rounded p-1 text-text-secondary hover:bg-sidebar"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-serif font-semibold" aria-live="polite">
          {formatMonth(month)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className="rounded p-1 text-text-secondary hover:bg-sidebar"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={formatMonth(month)}
        className="text-center text-sm"
      >
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((d) => (
            <span
              key={d}
              role="columnheader"
              className="py-1 text-xs text-text-secondary"
            >
              {d}
            </span>
          ))}
        </div>
        {monthGrid(month).map((week) => (
          <div key={week[0]!.date} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const disabled = min !== undefined && day.date < min
              const isSelected = day.date === selected
              const isToday = day.date === today
              const dayNum = Number(day.date.slice(8))
              // Visible day digit must appear in the accessible name (axe
              // label-content-name-mismatch); keep the full date after it.
              const label = `${dayNum} ${day.date.replaceAll('-', '/')}`
              return (
                <span
                  key={day.date}
                  role="gridcell"
                  aria-selected={isSelected}
                  className="flex"
                >
                  <button
                    data-date={day.date}
                    type="button"
                    tabIndex={day.date === focus ? 0 : -1}
                    aria-label={label}
                    aria-current={isToday ? 'date' : undefined}
                    disabled={disabled}
                    onClick={() => onSelect(day.date)}
                    onFocus={() => setFocus(day.date)}
                    className={[
                      'm-0.5 flex-1 rounded-full py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isSelected
                        ? 'bg-accent text-bg'
                        : isToday
                          ? 'font-semibold text-accent'
                          : day.inMonth
                            ? 'hover:bg-sidebar'
                            : 'text-text-secondary hover:bg-sidebar',
                      disabled ? 'cursor-not-allowed opacity-30' : '',
                    ].join(' ')}
                  >
                    {dayNum}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

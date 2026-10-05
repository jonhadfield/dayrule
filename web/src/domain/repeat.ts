// Repeat rules (PLAN.md §4.2): the dates a repeating to-do falls on. A
// small subset of iCalendar RRULE, enough for "every N days/weeks/months/
// years", weekly on chosen weekdays, and "N units after completion".

import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  getDaysInMonth,
} from 'date-fns'
import { addLocalDays, fromLocalDate, toLocalDate } from './dates'
import type { LocalDate, Repeat } from './types'

/** Monday = 0 … Sunday = 6. */
function weekday(d: Date): number {
  return (d.getDay() + 6) % 7
}

function mondayOf(d: Date): Date {
  return addDays(d, -weekday(d))
}

/** The day `day` of the month of `month`, clamped to its last day. */
function clampedDay(month: Date, day: number): Date {
  return new Date(
    month.getFullYear(),
    month.getMonth(),
    Math.min(day, getDaysInMonth(month)),
  )
}

/** Is `date` an occurrence of a fixed schedule? */
function isOccurrence(r: Repeat, date: Date, anchor: Date): boolean {
  if (date < anchor) return false
  switch (r.freq) {
    case 'day':
      return differenceInCalendarDays(date, anchor) % r.every === 0
    case 'week': {
      const days = r.weekdays?.length ? r.weekdays : [weekday(anchor)]
      if (!days.includes(weekday(date))) return false
      const weeks =
        differenceInCalendarDays(mondayOf(date), mondayOf(anchor)) / 7
      return weeks % r.every === 0
    }
    case 'month': {
      const months =
        (date.getFullYear() - anchor.getFullYear()) * 12 +
        date.getMonth() -
        anchor.getMonth()
      return (
        months % r.every === 0 &&
        date.getDate() === clampedDay(date, anchor.getDate()).getDate()
      )
    }
    case 'year': {
      const years = date.getFullYear() - anchor.getFullYear()
      return (
        years % r.every === 0 &&
        date.getMonth() === anchor.getMonth() &&
        date.getDate() === clampedDay(date, anchor.getDate()).getDate()
      )
    }
  }
}

/** The first occurrence of a fixed schedule on or after `from`. */
export function occurrenceOnOrAfter(r: Repeat, from: LocalDate): LocalDate {
  const anchor = fromLocalDate(r.anchor)
  let d = fromLocalDate(from < r.anchor ? r.anchor : from)
  if (r.freq === 'month' || r.freq === 'year') {
    // Step a month (or year) at a time, checking that month's date.
    // Yearly steps through the anchor's month in each year.
    const step = r.freq === 'month' ? 1 : 12
    const start = new Date(
      d.getFullYear(),
      r.freq === 'month' ? d.getMonth() : anchor.getMonth(),
      1,
    )
    for (let i = 0; i < 12 * 400; i += step) {
      const month = addMonths(start, i)
      const candidate = clampedDay(month, anchor.getDate())
      if (candidate >= d && isOccurrence(r, candidate, anchor))
        return toLocalDate(candidate)
    }
  } else {
    // At most every × 7 days apart; scan a bounded window.
    for (let i = 0; i < r.every * 7 + 7; i++) {
      if (isOccurrence(r, d, anchor)) return toLocalDate(d)
      d = addDays(d, 1)
    }
  }
  throw new Error('no occurrence found') // unreachable for valid rules
}

/** The next occurrence after `date` on a fixed schedule. */
export function occurrenceAfter(r: Repeat, date: LocalDate): LocalDate {
  return occurrenceOnOrAfter(r, addLocalDays(date, 1))
}

/** For "after completion": the due date N units after `done`. */
export function dueAfterCompletion(r: Repeat, done: LocalDate): LocalDate {
  const d = fromLocalDate(done)
  switch (r.freq) {
    case 'day':
      return toLocalDate(addDays(d, r.every))
    case 'week':
      return toLocalDate(addDays(d, 7 * r.every))
    case 'month':
      return toLocalDate(addMonths(d, r.every))
    case 'year':
      return toLocalDate(addYears(d, r.every))
  }
}

/** A short description: "Every week on Mon, Thu", "Every 2 months". */
export function describeRepeat(r: Repeat): string {
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[
    r.freq
  ]
  const every = r.every === 1 ? `Every ${unit}` : `Every ${r.every} ${unit}s`
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const on =
    r.freq === 'week' && r.weekdays?.length
      ? ` on ${[...r.weekdays]
          .sort()
          .map((d) => names[d])
          .join(', ')}`
      : ''
  return r.mode === 'afterCompletion'
    ? `${every} after completion`
    : `${every}${on}`
}

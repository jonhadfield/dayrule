// Month grids for the calendar picker. Weeks start on Monday (decision 9).

import { addLocalDays, fromLocalDate, toLocalDate } from './dates'
import type { LocalDate } from './types'

export interface CalendarDay {
  date: LocalDate
  /** False for the leading/trailing days from neighbouring months. */
  inMonth: boolean
}

/** First day of the month containing `date`, as `YYYY-MM-01`. */
export function monthOf(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

export function addMonths(month: LocalDate, n: number): LocalDate {
  const d = fromLocalDate(month)
  return toLocalDate(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

/**
 * The same day number in another month, clamped to that month's last day
 * (31 January → 28 or 29 February).
 */
export function sameDayInMonth(month: LocalDate, day: LocalDate): LocalDate {
  const lastDay = addLocalDays(addMonths(monthOf(month), 1), -1)
  const candidate = `${month.slice(0, 8)}${day.slice(8)}`
  return candidate > lastDay ? lastDay : candidate
}

/** Six Monday-first weeks covering the month, so the grid never jumps. */
export function monthGrid(month: LocalDate): CalendarDay[][] {
  const first = fromLocalDate(monthOf(month))
  const lead = (first.getDay() + 6) % 7 // days before the 1st, Monday = 0
  const start = addLocalDays(toLocalDate(first), -lead)
  const prefix = month.slice(0, 7)
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addLocalDays(start, w * 7 + d)
      return { date, inMonth: date.startsWith(prefix) }
    }),
  )
}

/** Month heading in year/month order, e.g. "2026/10". */
export function formatMonth(month: LocalDate): string {
  return month.slice(0, 7).replace('-', '/')
}

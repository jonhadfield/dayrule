// Local-date helpers and the natural-language date parser (PLAN.md §7.3).
//
// Conventions (decision 9): year/month/day order everywhere. Dates display
// as 2026/10/04, and short typed dates read as month/day, so "10/4" is
// 4 October. Weeks start on Monday.

import { addDays, addMonths, addWeeks, format, isValid, parse } from 'date-fns'
import type { LocalDate } from './types'

const LOCAL_DATE = 'yyyy-MM-dd'

export function toLocalDate(d: Date): LocalDate {
  return format(d, LOCAL_DATE)
}

export function fromLocalDate(s: LocalDate): Date {
  return parse(s, LOCAL_DATE, new Date(0))
}

export function addLocalDays(s: LocalDate, days: number): LocalDate {
  return toLocalDate(addDays(fromLocalDate(s), days))
}

/**
 * A "HH:mm" time rounded to the nearest quarter hour, the only times
 * reminders go off (the sender runs every 15 minutes, PLAN.md §10.5).
 * Times after 23:52 round down to 23:45 so the day never changes.
 */
export function roundToQuarter(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const quarters = Math.min(Math.round((h * 60 + m) / 15), 24 * 4 - 1)
  const mins = quarters * 15
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/** Display form: 2026/10/04. */
export function formatDisplayDate(s: LocalDate): string {
  return format(fromLocalDate(s), 'yyyy/MM/dd')
}

export type WhenResult =
  { kind: 'today' } | { kind: 'later' } | { kind: 'date'; date: LocalDate }

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const

/** Match a word or any prefix of at least `min` letters ("tom", "fri"). */
function matchPrefix<T extends string>(
  word: string,
  candidates: readonly T[],
  min = 3,
): number {
  if (word.length < min) return -1
  return candidates.findIndex((c) => c.startsWith(word))
}

/** ISO weekday index with Monday = 0. */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

function validDate(y: number, m: number, d: number): LocalDate | null {
  const date = new Date(y, m - 1, d)
  if (
    !isValid(date) ||
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null
  }
  return toLocalDate(date)
}

/**
 * Month/day without a year means the next occurrence: this year if it's
 * today or later, otherwise next year.
 */
function nextMonthDay(today: Date, m: number, d: number): LocalDate | null {
  const year = today.getFullYear()
  const thisYear = validDate(year, m, d)
  if (thisYear && thisYear >= toLocalDate(today)) return thisYear
  return validDate(year + 1, m, d)
}

/**
 * Parse what someone typed into the When field. Returns null when the input
 * isn't understood, so the UI can say so instead of guessing.
 */
export function parseWhen(input: string, today: Date): WhenResult | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (s === '') return null

  if (s === 'today' || s === 'tod') return { kind: 'today' }
  if (s === 'tonight' || s === 'evening' || s === 'this evening') {
    return { kind: 'today' }
  }
  if (s === 'later' || s === 'some' || s === 'not now') return { kind: 'later' }

  const date = (d: Date): WhenResult => ({ kind: 'date', date: toLocalDate(d) })

  if (matchPrefix(s, ['tomorrow']) === 0) return date(addDays(today, 1))
  if (s === 'next week') {
    // The Monday of next week.
    return date(addDays(today, 7 - mondayIndex(today)))
  }
  if (s === 'next month') {
    const first = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    return date(first)
  }

  const inN = /^in (\d{1,3}) (day|days|week|weeks|month|months)$/.exec(s)
  if (inN) {
    const n = Number(inN[1])
    const unit = inN[2] ?? ''
    if (unit.startsWith('day')) return date(addDays(today, n))
    if (unit.startsWith('week')) return date(addWeeks(today, n))
    return date(addMonths(today, n))
  }

  const isNext = s.startsWith('next ')
  const weekday = matchPrefix(s.replace(/^next /, ''), WEEKDAYS)
  if (weekday !== -1) {
    if (isNext) {
      // "next fri": that weekday in next calendar week (weeks start Monday).
      const nextMonday = addDays(today, 7 - mondayIndex(today))
      return date(addDays(nextMonday, weekday))
    }
    // "fri": the next occurrence, never today.
    let delta = (weekday - mondayIndex(today) + 7) % 7
    if (delta === 0) delta = 7
    return date(addDays(today, delta))
  }

  // Full dates, year first: 2026/10/04, 2026-10-04, 2026.10.04
  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s)
  if (ymd) {
    const d = validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
    return d ? { kind: 'date', date: d } : null
  }

  // Short dates, month first: 10/4 = 4 October.
  const md = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s)
  if (md) {
    const d = nextMonthDay(today, Number(md[1]), Number(md[2]))
    return d ? { kind: 'date', date: d } : null
  }

  // "5 oct", "oct 5", "5 october"
  const dm = /^(\d{1,2}) ([a-z]+)$/.exec(s) ?? null
  const mdWords = /^([a-z]+) (\d{1,2})$/.exec(s) ?? null
  const day = Number(dm?.[1] ?? mdWords?.[2])
  const monthWord = dm?.[2] ?? mdWords?.[1]
  if (monthWord !== undefined) {
    const month = matchPrefix(monthWord, MONTHS)
    if (month === -1) return null
    const d = nextMonthDay(today, month + 1, day)
    return d ? { kind: 'date', date: d } : null
  }

  return null
}

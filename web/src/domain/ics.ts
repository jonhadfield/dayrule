// Minimal ICS (iCalendar) parser for a calendar overlay on Today / Scheduled
// (PLAN.md §8.3). File import only in this slice — fetching a URL needs a
// CORS proxy (and would leak the feed URL to that proxy); document before
// enabling network fetch.

import { toLocalDate } from './dates'
import type { LocalDate } from './types'

export type CalendarEvent = {
  uid: string
  title: string
  /** Local calendar date the event starts on. */
  date: LocalDate
  /** "HH:mm" when timed; omitted for all-day events. */
  time?: string
}

/** Unfold RFC 5545 line folding, then split into content lines. */
export function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** Parse DTSTART / DTEND into a local date and optional HH:mm. */
export function parseIcsDate(
  value: string,
  params: string,
): { date: LocalDate; time?: string } | null {
  const v = value.trim()
  if (/^\d{8}$/.test(v) || /VALUE=DATE/i.test(params)) {
    const day = v.slice(0, 8)
    if (!/^\d{8}$/.test(day)) return null
    return {
      date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
    }
  }
  // 20261116T090000 or 20261116T090000Z or with TZID (treat as local clock)
  const m = v.match(/^(\d{8})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const [, day, hh, mm] = m
  if (m[5] === 'Z') {
    const utc = new Date(
      Date.UTC(
        Number(day!.slice(0, 4)),
        Number(day!.slice(4, 6)) - 1,
        Number(day!.slice(6, 8)),
        Number(hh),
        Number(mm),
        Number(m[4]),
      ),
    )
    return {
      date: toLocalDate(utc),
      time: `${String(utc.getHours()).padStart(2, '0')}:${String(utc.getMinutes()).padStart(2, '0')}`,
    }
  }
  return {
    date: `${day!.slice(0, 4)}-${day!.slice(4, 6)}-${day!.slice(6, 8)}`,
    time: `${hh}:${mm}`,
  }
}

function splitProp(
  line: string,
): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const left = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const semi = left.indexOf(';')
  if (semi < 0) return { name: left.toUpperCase(), params: '', value }
  return {
    name: left.slice(0, semi).toUpperCase(),
    params: left.slice(semi + 1),
    value,
  }
}

/**
 * Extract VEVENT summaries for the overlay. Ignores VTIMEZONE, alarms, and
 * recurrence expansion (one row per VEVENT as written).
 */
export function parseIcs(text: string): CalendarEvent[] {
  const lines = unfoldIcs(text)
  const out: CalendarEvent[] = []
  let inEvent = false
  let uid = ''
  let title = ''
  let start: { date: LocalDate; time?: string } | null = null

  const flush = () => {
    if (start && title.trim()) {
      out.push({
        uid: uid || `anon-${out.length}-${start.date}`,
        title: title.trim(),
        date: start.date,
        ...(start.time ? { time: start.time } : {}),
      })
    }
    uid = ''
    title = ''
    start = null
  }

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      uid = ''
      title = ''
      start = null
      continue
    }
    if (line === 'END:VEVENT') {
      if (inEvent) flush()
      inEvent = false
      continue
    }
    if (!inEvent) continue
    const prop = splitProp(line)
    if (!prop) continue
    if (prop.name === 'UID') uid = prop.value.trim()
    else if (prop.name === 'SUMMARY') title = unescapeText(prop.value)
    else if (prop.name === 'DTSTART') {
      start = parseIcsDate(prop.value, prop.params)
    }
  }
  return out.sort((a, b) =>
    a.date === b.date
      ? (a.time ?? '').localeCompare(b.time ?? '') ||
        a.title.localeCompare(b.title)
      : a.date.localeCompare(b.date),
  )
}

export function eventsOnDate(
  events: CalendarEvent[],
  date: LocalDate,
): CalendarEvent[] {
  return events.filter((e) => e.date === date)
}

export function eventsFromDate(
  events: CalendarEvent[],
  from: LocalDate,
): CalendarEvent[] {
  return events.filter((e) => e.date >= from)
}

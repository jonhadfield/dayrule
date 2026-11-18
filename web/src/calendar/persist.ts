// Device-local calendar overlay memory (PLAN.md §8.3).
// Remembers the last https URL and fetched/imported ICS text so events
// return after unlock without another fetch. Not synced; never sent except
// when Refresh hits POST /api/v1/calendar/ics.

const KEY = 'dayrule.calendar-overlay'

export type PersistedCalendar = {
  url: string | null
  text: string | null
  sourceName: string | null
}

export function loadCalendarPersist(): PersistedCalendar {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const v = JSON.parse(raw) as Partial<PersistedCalendar>
    return {
      url: typeof v.url === 'string' && v.url ? v.url : null,
      text: typeof v.text === 'string' && v.text ? v.text : null,
      sourceName:
        typeof v.sourceName === 'string' && v.sourceName ? v.sourceName : null,
    }
  } catch {
    return empty()
  }
}

export function saveCalendarPersist(next: PersistedCalendar): void {
  try {
    if (!next.url && !next.text) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode: in-memory overlay only.
  }
}

export function clearCalendarPersist(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

function empty(): PersistedCalendar {
  return { url: null, text: null, sourceName: null }
}

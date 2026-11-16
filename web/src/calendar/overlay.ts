// In-browser calendar overlay for Today / Scheduled (PLAN.md §8.3).
// Events stay on this device (zustand); cleared when the vault locks.
// URL fetch / CORS proxy is intentionally not wired yet.

import { create } from 'zustand'
import { parseIcs, type CalendarEvent } from '../domain/ics'

type State = {
  events: CalendarEvent[]
  sourceName: string | null
  setFromIcs: (text: string, sourceName: string) => number
  clear: () => void
}

export const useCalendarOverlay = create<State>((set) => ({
  events: [],
  sourceName: null,
  setFromIcs: (text, sourceName) => {
    const events = parseIcs(text)
    set({ events, sourceName })
    return events.length
  },
  clear: () => set({ events: [], sourceName: null }),
}))

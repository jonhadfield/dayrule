// In-browser calendar overlay for Today / Scheduled (PLAN.md §8.3).
// Events stay on this device (zustand); cleared when the vault locks
// (lock() reloads the page). File import is local; URL fetch goes through
// Dayrule's same-origin API so CSP connect-src stays 'self' + HIBP only.

import { create } from 'zustand'
import { api } from '../account/api'
import { parseIcs, type CalendarEvent } from '../domain/ics'

type State = {
  events: CalendarEvent[]
  sourceName: string | null
  setFromIcs: (text: string, sourceName: string) => number
  fetchFromUrl: (url: string) => Promise<number>
  clear: () => void
}

export const useCalendarOverlay = create<State>((set, get) => ({
  events: [],
  sourceName: null,
  setFromIcs: (text, sourceName) => {
    const events = parseIcs(text)
    set({ events, sourceName })
    return events.length
  },
  fetchFromUrl: async (url) => {
    const { text } = await api<{ text: string }>('POST', '/calendar/ics', {
      url,
    })
    let host = url
    try {
      host = new URL(url).hostname
    } catch {
      /* keep raw */
    }
    return get().setFromIcs(text, host)
  },
  clear: () => set({ events: [], sourceName: null }),
}))

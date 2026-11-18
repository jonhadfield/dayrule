// In-browser calendar overlay for Today / Scheduled (PLAN.md §8.3).
// File import is local; URL fetch goes through Dayrule's same-origin API
// so CSP connect-src stays 'self' + HIBP only. The last URL and ICS text
// are remembered on this device so events return after unlock; Refresh
// re-fetches. Clear forgets the overlay and the saved feed.

import { create } from 'zustand'
import { api } from '../account/api'
import { parseIcs, type CalendarEvent } from '../domain/ics'
import {
  clearCalendarPersist,
  loadCalendarPersist,
  saveCalendarPersist,
} from './persist'

type State = {
  events: CalendarEvent[]
  sourceName: string | null
  /** Last https feed URL on this device, if any. */
  sourceUrl: string | null
  setFromIcs: (text: string, sourceName: string, url?: string | null) => number
  fetchFromUrl: (url: string) => Promise<number>
  refresh: () => Promise<number>
  clear: () => void
}

function hydrate(): Pick<State, 'events' | 'sourceName' | 'sourceUrl'> {
  const saved = loadCalendarPersist()
  if (!saved.text) {
    return { events: [], sourceName: null, sourceUrl: saved.url }
  }
  return {
    events: parseIcs(saved.text),
    sourceName: saved.sourceName,
    sourceUrl: saved.url,
  }
}

function persist(
  text: string | null,
  sourceName: string | null,
  sourceUrl: string | null,
) {
  saveCalendarPersist({ url: sourceUrl, text, sourceName })
}

export const useCalendarOverlay = create<State>((set, get) => ({
  ...hydrate(),
  setFromIcs: (text, sourceName, url) => {
    const events = parseIcs(text)
    const sourceUrl = url === undefined ? get().sourceUrl : url
    set({ events, sourceName, sourceUrl })
    persist(text, sourceName, sourceUrl)
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
    return get().setFromIcs(text, host, url)
  },
  refresh: async () => {
    const url = get().sourceUrl
    if (!url) throw new Error('No calendar URL saved on this device.')
    return get().fetchFromUrl(url)
  },
  clear: () => {
    clearCalendarPersist()
    set({ events: [], sourceName: null, sourceUrl: null })
  },
}))

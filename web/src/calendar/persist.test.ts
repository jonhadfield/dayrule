import { afterEach, describe, expect, it } from 'vitest'
import {
  clearCalendarPersist,
  loadCalendarPersist,
  saveCalendarPersist,
} from './persist'

afterEach(() => {
  clearCalendarPersist()
})

describe('calendar persist', () => {
  it('round-trips url, text and source name', () => {
    saveCalendarPersist({
      url: 'https://cal.example/feed.ics',
      text: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
      sourceName: 'cal.example',
    })
    expect(loadCalendarPersist()).toEqual({
      url: 'https://cal.example/feed.ics',
      text: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
      sourceName: 'cal.example',
    })
  })

  it('clears storage when empty', () => {
    saveCalendarPersist({
      url: 'https://cal.example/feed.ics',
      text: 'x',
      sourceName: 'cal.example',
    })
    saveCalendarPersist({ url: null, text: null, sourceName: null })
    expect(loadCalendarPersist()).toEqual({
      url: null,
      text: null,
      sourceName: null,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { parseIcs, parseIcsDate, unfoldIcs } from './ics'

describe('unfoldIcs', () => {
  it('joins folded lines', () => {
    expect(unfoldIcs('SUMMARY:Hello\n  world\nUID:1\r\n').join('|')).toBe(
      'SUMMARY:Hello world|UID:1|',
    )
  })
})

describe('parseIcsDate', () => {
  it('parses all-day VALUE=DATE', () => {
    expect(parseIcsDate('20261116', 'VALUE=DATE')).toEqual({
      date: '2026-11-16',
    })
  })

  it('parses floating local date-time', () => {
    expect(parseIcsDate('20261116T093000', '')).toEqual({
      date: '2026-11-16',
      time: '09:30',
    })
  })

  it('converts UTC Z to the local calendar day', () => {
    const got = parseIcsDate('20261116T230000Z', '')
    expect(got?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(got?.time).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('parseIcs', () => {
  it('reads VEVENT summaries', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a@example.com
DTSTART;VALUE=DATE:20261116
SUMMARY:Dentist
END:VEVENT
BEGIN:VEVENT
UID:b@example.com
DTSTART:20261117T140000
SUMMARY:Team sync\\, room 4
END:VEVENT
END:VCALENDAR`

    expect(parseIcs(ics)).toEqual([
      { uid: 'a@example.com', title: 'Dentist', date: '2026-11-16' },
      {
        uid: 'b@example.com',
        title: 'Team sync, room 4',
        date: '2026-11-17',
        time: '14:00',
      },
    ])
  })

  it('skips events without a title or start', () => {
    expect(
      parseIcs(`BEGIN:VEVENT
UID:x
DTSTART;VALUE=DATE:20261116
END:VEVENT`),
    ).toEqual([])
  })
})

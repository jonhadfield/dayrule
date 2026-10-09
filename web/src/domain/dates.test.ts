import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  formatDisplayDate,
  parseWhen,
  roundToQuarter,
  toLocalDate,
} from './dates'

describe('roundToQuarter', () => {
  it.each([
    ['09:00', '09:00'],
    ['09:07', '09:00'],
    ['09:08', '09:15'],
    ['14:22', '14:15'],
    ['14:23', '14:30'],
    ['10:53', '11:00'],
    ['00:05', '00:00'],
    ['23:52', '23:45'],
    ['23:53', '23:45'],
    ['23:59', '23:45'],
  ])('%s → %s', (input, out) => {
    expect(roundToQuarter(input)).toBe(out)
  })
})

// Sunday 4 October 2026.
const today = new Date(2026, 9, 4)
const date = (d: string) => ({ kind: 'date', date: d })

describe('parseWhen', () => {
  it.each([
    ['today', { kind: 'today' }],
    ['Today ', { kind: 'today' }],
    ['tonight', { kind: 'today' }],
    ['this evening', { kind: 'today' }],
    ['evening', { kind: 'today' }],
    ['later', { kind: 'later' }],
    ['tom', date('2026-10-05')],
    ['tomorrow', date('2026-10-05')],
    ['in 3 days', date('2026-10-07')],
    ['in 2 weeks', date('2026-10-18')],
    ['in 1 month', date('2026-11-04')],
    ['next week', date('2026-10-05')],
    ['next month', date('2026-11-01')],
    ['mon', date('2026-10-05')],
    ['fri', date('2026-10-09')],
    ['friday', date('2026-10-09')],
    ['sun', date('2026-10-11')],
    ['next fri', date('2026-10-09')],
    ['2026/10/20', date('2026-10-20')],
    ['2026-10-20', date('2026-10-20')],
    ['2027/2/3', date('2027-02-03')],
  ])('%s', (input, want) => {
    expect(parseWhen(input, today)).toEqual(want)
  })

  it('reads short dates month-first (decision 9)', () => {
    expect(parseWhen('10/4', today)).toEqual(date('2026-10-04'))
    expect(parseWhen('10/20', today)).toEqual(date('2026-10-20'))
  })

  it('rolls short dates already past into next year', () => {
    expect(parseWhen('3/1', today)).toEqual(date('2027-03-01'))
    expect(parseWhen('5 jan', today)).toEqual(date('2027-01-05'))
  })

  it('accepts month names either side of the day', () => {
    expect(parseWhen('20 oct', today)).toEqual(date('2026-10-20'))
    expect(parseWhen('oct 20', today)).toEqual(date('2026-10-20'))
    expect(parseWhen('20 October', today)).toEqual(date('2026-10-20'))
  })

  it('treats "next <weekday>" as that day in next calendar week', () => {
    // Wednesday 7 October 2026: next week starts Monday 12th.
    const wed = new Date(2026, 9, 7)
    expect(parseWhen('next mon', wed)).toEqual(date('2026-10-12'))
    expect(parseWhen('next fri', wed)).toEqual(date('2026-10-16'))
    expect(parseWhen('fri', wed)).toEqual(date('2026-10-09'))
  })

  it('never returns today for a bare weekday', () => {
    expect(parseWhen('sun', today)).toEqual(date('2026-10-11'))
  })

  it.each(['', 'xyz', '2026/13/01', '2/30', '31 feb', 'to', 'in 3 years'])(
    'rejects %j',
    (input) => {
      expect(parseWhen(input, today)).toBeNull()
    },
  )
})

describe('local dates', () => {
  it('formats as year/month/day', () => {
    expect(formatDisplayDate('2026-10-04')).toBe('2026/10/04')
  })

  it('adds days across month and year ends', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('uses the local calendar date, not UTC', () => {
    expect(toLocalDate(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
  })
})

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  describeRepeat,
  dueAfterCompletion,
  occurrenceAfter,
  occurrenceOnOrAfter,
} from './repeat'
import type { Repeat } from './types'

const rule = (r: Partial<Repeat>): Repeat => ({
  freq: 'day',
  every: 1,
  mode: 'fixed',
  anchor: '2026-10-04',
  ...r,
})

/** Successive occurrences from the anchor. */
function first(r: Repeat, n: number): string[] {
  const out = [occurrenceOnOrAfter(r, r.anchor)]
  while (out.length < n) out.push(occurrenceAfter(r, out[out.length - 1]!))
  return out
}

describe('repeat rules', () => {
  it('every N days', () => {
    expect(first(rule({ every: 3 }), 3)).toEqual([
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ])
    expect(occurrenceOnOrAfter(rule({ every: 3 }), '2026-10-05')).toBe(
      '2026-10-07',
    )
  })

  it('weekly on chosen weekdays, and every other week', () => {
    // 2026-10-04 is a Sunday.
    const monThu = rule({ freq: 'week', weekdays: [0, 3] })
    expect(first(monThu, 4)).toEqual([
      '2026-10-05',
      '2026-10-08',
      '2026-10-12',
      '2026-10-15',
    ])
    const fortnightly = rule({
      freq: 'week',
      every: 2,
      weekdays: [0],
      anchor: '2026-10-05',
    })
    expect(first(fortnightly, 3)).toEqual([
      '2026-10-05',
      '2026-10-19',
      '2026-11-02',
    ])
    // Without weekdays, the anchor's weekday.
    expect(first(rule({ freq: 'week' }), 2)).toEqual([
      '2026-10-04',
      '2026-10-11',
    ])
  })

  it('monthly on the anchor day, clamped to short months', () => {
    expect(first(rule({ freq: 'month', anchor: '2026-01-31' }), 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(
      first(rule({ freq: 'month', every: 3, anchor: '2026-10-15' }), 3),
    ).toEqual(['2026-10-15', '2027-01-15', '2027-04-15'])
  })

  it('yearly, with 29 February falling back to the 28th', () => {
    expect(first(rule({ freq: 'year', anchor: '2028-02-29' }), 3)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ])
  })

  it('is unaffected by daylight saving changes', () => {
    // UK clocks change on 2026-10-25 and 2027-03-28.
    expect(first(rule({ anchor: '2026-10-24' }), 3)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
    expect(first(rule({ freq: 'week', anchor: '2027-03-22' }), 2)).toEqual([
      '2027-03-22',
      '2027-03-29',
    ])
  })

  it('after completion counts from the completion date', () => {
    expect(
      dueAfterCompletion(
        rule({ every: 3, mode: 'afterCompletion' }),
        '2026-10-04',
      ),
    ).toBe('2026-10-07')
    expect(
      dueAfterCompletion(
        rule({ freq: 'week', mode: 'afterCompletion' }),
        '2026-10-04',
      ),
    ).toBe('2026-10-11')
    expect(
      dueAfterCompletion(
        rule({ freq: 'month', mode: 'afterCompletion' }),
        '2026-01-31',
      ),
    ).toBe('2026-02-28')
  })

  it('always moves strictly forward to a matching date', () => {
    const arb = fc.record({
      freq: fc.constantFrom('day', 'week', 'month', 'year'),
      every: fc.integer({ min: 1, max: 6 }),
      weekdays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), {
        maxLength: 7,
      }),
      day: fc.integer({ min: 0, max: 3000 }),
    })
    fc.assert(
      fc.property(arb, ({ freq, every, weekdays, day }) => {
        const anchor = new Date(2024, 0, 1 + day)
        const iso = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const r = rule({
          freq: freq as Repeat['freq'],
          every,
          weekdays,
          anchor: iso(anchor),
        })
        const a = occurrenceOnOrAfter(r, r.anchor)
        const b = occurrenceAfter(r, a)
        expect(a >= r.anchor).toBe(true)
        expect(b > a).toBe(true)
        expect(occurrenceOnOrAfter(r, b)).toBe(b)
      }),
      { numRuns: 300 },
    )
  })

  it('describes rules', () => {
    expect(describeRepeat(rule({ freq: 'week', weekdays: [3, 0] }))).toBe(
      'Every week on Mon, Thu',
    )
    expect(describeRepeat(rule({ freq: 'month', every: 2 }))).toBe(
      'Every 2 months',
    )
    expect(describeRepeat(rule({ every: 3, mode: 'afterCompletion' }))).toBe(
      'Every 3 days after completion',
    )
  })
})

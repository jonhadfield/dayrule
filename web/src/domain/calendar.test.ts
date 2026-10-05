import { describe, expect, it } from 'vitest'
import {
  addMonths,
  formatMonth,
  monthGrid,
  monthOf,
  sameDayInMonth,
} from './calendar'

describe('monthGrid', () => {
  it('starts weeks on Monday and always has six weeks', () => {
    // October 2026 starts on a Thursday.
    const grid = monthGrid('2026-10-01')
    expect(grid).toHaveLength(6)
    expect(grid[0]?.map((d) => d.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(grid[0]?.map((d) => d.inMonth)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ])
  })

  it('handles a month starting on Monday and leap Februaries', () => {
    expect(monthGrid('2027-02-01')[0]?.[0]?.date).toBe('2027-02-01')
    const feb2028 = monthGrid('2028-02-01')
      .flat()
      .filter((d) => d.inMonth)
    expect(feb2028).toHaveLength(29)
  })
})

describe('month helpers', () => {
  it('finds the month, moves between months and formats year/month', () => {
    expect(monthOf('2026-10-17')).toBe('2026-10-01')
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(formatMonth('2026-10-01')).toBe('2026/10')
  })

  it('keeps the day number when changing month, clamped to the month end', () => {
    expect(sameDayInMonth('2026-11-01', '2026-10-17')).toBe('2026-11-17')
    expect(sameDayInMonth('2027-02-01', '2027-01-31')).toBe('2027-02-28')
    expect(sameDayInMonth('2028-02-01', '2028-01-31')).toBe('2028-02-29')
  })
})

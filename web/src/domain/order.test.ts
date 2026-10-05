import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compareKeys, keyAfterLast, keyAtIndex, keyBetween } from './order'

describe('ordering keys', () => {
  it('appends after the last key', () => {
    const a = keyBetween(null, null)
    const b = keyAfterLast([a])
    expect(compareKeys(a, b)).toBe(-1)
  })

  it('inserts at an index between neighbours', () => {
    const first = keyBetween(null, null)
    const second = keyBetween(first, null)
    const mid = keyAtIndex([first, second], 1)
    expect(compareKeys(first, mid)).toBe(-1)
    expect(compareKeys(mid, second)).toBe(-1)
  })

  it('keeps any sequence of random inserts strictly ordered', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 60 }), (positions) => {
        const keys: string[] = []
        for (const p of positions) {
          const index = keys.length === 0 ? 0 : p % (keys.length + 1)
          keys.splice(index, 0, keyAtIndex(keys, index))
        }
        for (let i = 1; i < keys.length; i++) {
          expect(compareKeys(keys[i - 1] ?? '', keys[i] ?? '')).toBe(-1)
        }
      }),
    )
  })
})

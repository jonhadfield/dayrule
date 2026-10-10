import { describe, expect, it } from 'vitest'
import { DEFAULT_KDF } from '../crypto/primitives'
import {
  MAX_KDF_MEM,
  MAX_KDF_OPS,
  MIN_KDF_MEM,
  MIN_KDF_OPS,
  UNSAFE_KDF,
  checkServerKdf,
} from './kdf'

describe('checkServerKdf', () => {
  it('accepts the defaults and the ends of the range', () => {
    expect(() => checkServerKdf(DEFAULT_KDF)).not.toThrow()
    expect(() =>
      checkServerKdf({ v: 1, ops: MAX_KDF_OPS, mem: MAX_KDF_MEM }),
    ).not.toThrow()
  })

  it('matches the defaults the client signs up with', () => {
    expect(MIN_KDF_OPS).toBe(DEFAULT_KDF.ops)
    expect(MIN_KDF_MEM).toBe(DEFAULT_KDF.mem)
  })

  it.each([
    ['cheaper iterations', { v: 1, ops: 1, mem: MIN_KDF_MEM }],
    ['less memory', { v: 1, ops: 3, mem: 8 * 1024 * 1024 }],
    ['memory in KiB, not bytes', { v: 1, ops: 3, mem: 65536 }],
    ['too many iterations', { v: 1, ops: MAX_KDF_OPS + 1, mem: MIN_KDF_MEM }],
    ['too much memory', { v: 1, ops: 3, mem: MAX_KDF_MEM + 1 }],
    ['an unknown version', { v: 2, ops: 3, mem: MIN_KDF_MEM }],
    ['fractional values', { v: 1, ops: 3.5, mem: MIN_KDF_MEM }],
    ['strings', { v: 1, ops: '3', mem: String(MIN_KDF_MEM) }],
    ['missing fields', { v: 1 }],
    ['null', null],
  ])('refuses %s', (_, kdf) => {
    expect(() => checkServerKdf(kdf)).toThrow(UNSAFE_KDF)
  })
})

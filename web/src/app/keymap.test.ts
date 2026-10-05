import { describe, expect, it } from 'vitest'
import { BINDINGS, comboOf } from './keymap'

const ev = (init: KeyboardEventInit & { code?: string }) =>
  new KeyboardEvent('keydown', init)

describe('comboOf', () => {
  it('normalises letters by code, so Option+N is alt+n', () => {
    expect(comboOf(ev({ key: '˜', code: 'KeyN', altKey: true }))).toBe('alt+n')
    expect(comboOf(ev({ key: 'K', code: 'KeyK', shiftKey: true }))).toBe(
      'shift+k',
    )
  })

  it('maps arrows and named keys', () => {
    expect(
      comboOf(ev({ key: 'ArrowUp', code: 'ArrowUp', shiftKey: true })),
    ).toBe('shift+up')
    expect(comboOf(ev({ key: 'Escape', code: 'Escape' }))).toBe('escape')
    expect(comboOf(ev({ key: '?', code: 'Slash', shiftKey: true }))).toBe('?')
  })
})

describe('bindings', () => {
  it('has no duplicate key combos', () => {
    const keys = BINDINGS.map((b) => b.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only allows modifier combos (or Esc) while typing', () => {
    for (const b of BINDINGS.filter((x) => x.whileTyping)) {
      expect(b.keys === 'escape' || /(mod|alt)\+/.test(b.keys)).toBe(true)
    }
  })
})

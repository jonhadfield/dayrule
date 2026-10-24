import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissNotice,
  dismissUndo,
  postNotice,
  postUndo,
  useNotice,
} from './notice'

beforeEach(() => {
  vi.useFakeTimers()
  dismissNotice()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('notice center', () => {
  it('replaces the current notice and auto-dismisses Undo after 5s', () => {
    postUndo('Completed', () => {})
    expect(useNotice.getState().current?.message).toBe('Completed')
    postUndo('Moved to Trash', () => {})
    expect(useNotice.getState().current?.message).toBe('Moved to Trash')
    vi.advanceTimersByTime(4999)
    expect(useNotice.getState().current?.message).toBe('Moved to Trash')
    vi.advanceTimersByTime(1)
    expect(useNotice.getState().current).toBeNull()
  })

  it('dismissUndo leaves an error notice', () => {
    postNotice({ kind: 'error', message: 'Can’t sync' })
    dismissUndo()
    expect(useNotice.getState().current?.message).toBe('Can’t sync')
  })
})

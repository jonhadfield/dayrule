import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeBar } from './NoticeBar'
import { dismissNotice, postUndo } from './notice'

afterEach(() => {
  dismissNotice()
})

describe('NoticeBar', () => {
  it('shows the message and runs Undo', () => {
    const undo = vi.fn()
    postUndo('Completed Milk', undo)
    render(<NoticeBar />)
    expect(screen.getByRole('status', { name: 'Completed Milk' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

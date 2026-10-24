import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoverWhenHidden, PrivacyCover } from './PrivacyCover'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrivacyCover', () => {
  it('renders the brand only when shown', () => {
    const { rerender } = render(<PrivacyCover show={false} />)
    expect(screen.queryByText('Dayrule')).toBeNull()
    rerender(<PrivacyCover show />)
    expect(screen.getByText('Dayrule')).toBeVisible()
  })
})

describe('CoverWhenHidden', () => {
  it('covers decrypted content while the tab is hidden', () => {
    const vis = vi.spyOn(document, 'visibilityState', 'get')
    vis.mockReturnValue('visible')
    render(<CoverWhenHidden />)
    expect(screen.queryByText('Dayrule')).toBeNull()
    vis.mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByText('Dayrule')).toBeVisible()
    vis.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.queryByText('Dayrule')).toBeNull()
  })

  it('covers on pagehide', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    render(<CoverWhenHidden />)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(screen.getByText('Dayrule')).toBeVisible()
  })
})

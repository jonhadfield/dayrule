import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSyncStatus } from '../sync/controller'
import { SignInToSync } from './SignInAgain'
import { useAccount } from './session'

afterEach(() => {
  cleanup()
  useSyncStatus.setState({ state: { kind: 'starting' } })
  useAccount.setState({
    status: 'loading',
    profile: null,
    suggestTwoStep: false,
  })
})

describe('SignInToSync', () => {
  it('shows the banner and sign-in overlay when sync needs a session', () => {
    useAccount.setState({
      status: 'unlocked',
      suggestTwoStep: false,
      profile: {
        key: 'current',
        userId: 'u',
        email: 'ada@example.com',
        salt: '',
        kdf: { v: 1, ops: 1, mem: 1 },
        wrappedPassword: { nonce: '', ciphertext: '' },
        remember: false,
      },
    })
    useSyncStatus.setState({ state: { kind: 'needs-sign-in' } })
    render(<SignInToSync />)
    expect(screen.getByText('On this device only')).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to sync' }))
    expect(
      screen.getByRole('dialog', { name: 'Sign in to sync' }),
    ).toBeVisible()
    expect(screen.getByText('ada@example.com')).toBeVisible()
  })
})

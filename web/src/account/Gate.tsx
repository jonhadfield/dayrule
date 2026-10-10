import { useEffect, useState, type ReactNode } from 'react'
import { bootstrap } from '../app/bootstrap'
import { StoreProvider } from '../app/StoreProvider'
import type { EntityStore } from '../store/store'
import { Locked, SignedOut } from './screens'
import { lock, resume, useAccount } from './session'
import { TwoStepPrompt } from './TwoStepPrompt'
import { message } from './validation'

const AUTO_LOCK_MS = 15 * 60 * 1000 // decision 7

/** Decides what to show: account screens, or the app once unlocked. */
export function Gate({ children }: { children: ReactNode }) {
  const status = useAccount((s) => s.status)
  const profile = useAccount((s) => s.profile)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    resume().catch((err: unknown) => setError(message(err)))
  }, [])

  if (error) return <p className="p-6">{error}</p>
  if (status === 'loading') return null
  if (status === 'signed-out') return <SignedOut />
  if (status === 'locked' || !profile) return <Locked />
  return (
    <Unlocked userId={profile.userId} autoLock={!profile.remember}>
      {children}
    </Unlocked>
  )
}

function Unlocked({
  userId,
  autoLock,
  children,
}: {
  userId: string
  autoLock: boolean
  children: ReactNode
}) {
  const [store, setStore] = useState<EntityStore | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let stop: (() => void) | undefined
    bootstrap(userId)
      .then((b) => {
        stop = b.stop
        if (live) setStore(b.store)
        else b.stop()
      })
      .catch((err: unknown) => {
        console.error(err)
        if (live)
          setError(
            'Dayrule couldn’t open its local storage. Private browsing or blocked site data can cause this.',
          )
      })
    return () => {
      live = false
      stop?.()
    }
  }, [userId])

  useAutoLock(autoLock)

  if (error) return <p className="p-6">{error}</p>
  if (!store) return null
  return (
    <StoreProvider store={store}>
      {children}
      <TwoStepPrompt />
    </StoreProvider>
  )
}

/** Lock after 15 minutes without input, unless "stay unlocked" is on. */
function useAutoLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    const bump = () => (last = Date.now())
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, bump, { passive: true })
    const timer = setInterval(() => {
      if (Date.now() - last >= AUTO_LOCK_MS) void lock()
    }, 30_000)
    return () => {
      clearInterval(timer)
      for (const e of events) window.removeEventListener(e, bump)
    }
  }, [enabled])
}

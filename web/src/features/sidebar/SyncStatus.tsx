import { useEffect, useState } from 'react'
import { useSyncStatus, type SyncState } from '../../sync/controller'

function ago(at: number, now: number): string {
  const s = Math.round((now - at) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function describe(
  state: SyncState,
  now: number,
): { dot: string; text: string } {
  switch (state.kind) {
    case 'starting':
    case 'syncing':
      return { dot: 'bg-hairline', text: 'Syncing…' }
    case 'synced':
      return { dot: 'bg-ready', text: `Synced ${ago(state.at, now)}` }
    case 'other-tab':
      return { dot: 'bg-ready', text: 'Synced by another Dayrule tab' }
    case 'offline':
      return {
        dot: 'bg-text-secondary',
        text: 'Offline · changes saved on this device',
      }
    case 'blocked':
      return { dot: 'bg-deadline', text: state.message }
    case 'error':
      return {
        dot: 'bg-deadline',
        text: 'Can’t sync right now · changes saved on this device',
      }
    case 'needs-sign-in':
      return {
        dot: 'bg-deadline',
        text: 'On this device only · sign in to sync',
      }
  }
}

/** Where this device's changes stand with the server. */
export function SyncStatus() {
  const state = useSyncStatus((s) => s.state)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const { dot, text } = describe(state, now)
  return (
    <p
      className="flex items-center gap-2 text-xs text-text-secondary"
      role="status"
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {text}
    </p>
  )
}

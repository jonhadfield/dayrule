import { useState } from 'react'
import { applyUpdate, useAppUpdate } from './pwa'

/** Offers a downloaded new version; never reloads by itself. */
export function UpdateBanner() {
  const ready = useAppUpdate((s) => s.ready)
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[8px] border border-hairline bg-bg px-4 py-3 text-sm shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }}
    >
      <span className="flex-1">A new version of Dayrule is ready.</span>
      <button
        type="button"
        className="text-text-secondary"
        onClick={() => setDismissed(true)}
      >
        Later
      </button>
      <button
        type="button"
        className="font-semibold text-accent"
        onClick={applyUpdate}
      >
        Reload
      </button>
    </div>
  )
}

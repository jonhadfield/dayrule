// Hides decrypted lists (and the recovery phrase) in the browser app
// switcher when the tab is in the background (PLAN.md §10.4).

import { useEffect, useState } from 'react'

export function PrivacyCover({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg"
      role="presentation"
      aria-hidden
    >
      <p className="font-serif text-[34px] font-semibold tracking-tight">
        Dayrule
      </p>
    </div>
  )
}

function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  )
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden')
    const hide = () => setHidden(true)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', hide)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pagehide', hide)
    }
  }, [])
  return hidden
}

/** Cover the page when this tab is hidden. Mount only over decrypted screens. */
export function CoverWhenHidden() {
  return <PrivacyCover show={useTabHidden()} />
}

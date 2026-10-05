// Service worker registration and the update flow (PLAN.md §10.7): a new
// version installs in the background and waits; the user chooses when to
// reload into it.

import { create } from 'zustand'
import { trustedScriptUrl } from './trusted'

export const useAppUpdate = create<{ ready: boolean }>(() => ({ ready: false }))

let waiting: ServiceWorker | null = null
const HOUR = 60 * 60 * 1000

export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    // register() is a Trusted Types sink, like new Worker().
    const url = trustedScriptUrl('/sw.js') as unknown as string
    navigator.serviceWorker
      .register(url, { scope: '/' })
      .then((reg) => {
        const offer = (w: ServiceWorker) => {
          waiting = w
          useAppUpdate.setState({ ready: true })
        }
        // Only an update if a version is already running this page.
        if (reg.waiting && navigator.serviceWorker.controller)
          offer(reg.waiting)
        reg.addEventListener('updatefound', () => {
          const w = reg.installing
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller)
              offer(w)
          })
        })
        const check = () => void reg.update().catch(() => undefined)
        setInterval(check, HOUR)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
      })
      .catch((err: unknown) =>
        console.error('service worker registration failed', err),
      )
  })
}

/** Switch to the waiting version and reload into it. */
export function applyUpdate(): void {
  if (!waiting) return
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => location.reload(),
    { once: true },
  )
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION

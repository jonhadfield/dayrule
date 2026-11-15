// Client crash reports → POST /api/v1/errors (PLAN.md decision 10).
// Message and stack only; never request/response bodies. Fail open.

import { APP_VERSION } from './pwa'

const MAX_MESSAGE = 2 << 10 // 2 KiB (matches server)
const MAX_STACK = 12 << 10 // 12 KiB

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  return 'Unknown error'
}

function stackOf(err: unknown): string | undefined {
  return err instanceof Error && err.stack ? err.stack : undefined
}

/** Fire-and-forget report. Network or API failure is ignored. */
export function reportError(err: unknown, release: string = APP_VERSION): void {
  const message = clip(messageOf(err).trim(), MAX_MESSAGE)
  if (!message) return
  const stack = stackOf(err)
  void fetch('/api/v1/errors', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Dayrule-Client': 'web',
    },
    body: JSON.stringify({
      release: clip(release, 128),
      message,
      ...(stack ? { stack: clip(stack, MAX_STACK) } : {}),
    }),
  }).catch(() => undefined)
}

/** Uncaught errors and unhandled promise rejections. */
export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => {
    reportError(ev.error ?? ev.message)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    reportError(ev.reason)
  })
}

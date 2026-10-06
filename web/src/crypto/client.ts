// Page-side handle to the crypto worker. Every call is async and runs off
// the main thread, so Argon2 never freezes the UI.
import * as Comlink from 'comlink'
import workerUrl from './worker.ts?worker&url'
import { trustedScriptUrl } from '../app/trusted'
import type { Keyring } from './keyring'

// The worker file's SHA-384, written into this (SRI-checked) bundle at
// build time by vite.config.ts. Browsers have no integrity option for
// workers, so the file is fetched and checked before the worker starts
// (PLAN.md §10.7). Left as is in development.
const WORKER_INTEGRITY = '__DAYRULE_WORKER_INTEGRITY__'

export class WorkerIntegrityError extends Error {
  constructor() {
    super(
      'Dayrule couldn’t verify its encryption code, so it won’t run it. Reload to try again.',
    )
  }
}

async function verify(url: string): Promise<void> {
  try {
    // Rejects unless the whole body matches the hash.
    const res = await fetch(url, { integrity: `sha384-${WORKER_INTEGRITY}` })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await res.arrayBuffer()
  } catch (err) {
    console.error('crypto worker integrity check failed', err)
    throw new WorkerIntegrityError()
  }
}

async function start(): Promise<Comlink.Remote<Keyring>> {
  if (!import.meta.env.DEV) await verify(workerUrl)
  return Comlink.wrap<Keyring>(
    new Worker(trustedScriptUrl(workerUrl), { type: 'module', name: 'crypto' }),
  )
}

type Call = (...args: unknown[]) => Promise<unknown>

let remote: Comlink.Remote<Keyring> | null = null
let ready: Promise<Comlink.Remote<Keyring>> | null = null

function started(): Promise<Comlink.Remote<Keyring>> {
  if (!ready) {
    ready = start()
    // A failed check is retried on the next call, not remembered.
    ready.catch(() => (ready = null))
  }
  return ready
}

/**
 * The keyring in the worker. Calls wait for the integrity check, and
 * reject with WorkerIntegrityError if it fails.
 */
export function keyring(): Comlink.Remote<Keyring> {
  remote ??= new Proxy({} as Comlink.Remote<Keyring>, {
    get: (_, name) =>
      // Not a thenable: `await keyring()` must not look like a promise.
      name === 'then'
        ? undefined
        : (...args: unknown[]) =>
            started().then((r) => (Reflect.get(r, name) as Call)(...args)),
  })
  return remote
}

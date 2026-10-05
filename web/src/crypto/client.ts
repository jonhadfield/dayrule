// Page-side handle to the crypto worker. Every call is async and runs off
// the main thread, so Argon2 never freezes the UI.
import * as Comlink from 'comlink'
import workerUrl from './worker.ts?worker&url'
import { trustedScriptUrl } from '../app/trusted'
import type { Keyring } from './keyring'

let remote: Comlink.Remote<Keyring> | null = null

export function keyring(): Comlink.Remote<Keyring> {
  remote ??= Comlink.wrap<Keyring>(
    new Worker(trustedScriptUrl(workerUrl), { type: 'module', name: 'crypto' }),
  )
  return remote
}

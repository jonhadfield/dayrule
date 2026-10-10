// Two-step sign-in (PLAN.md §10.2, decision 30): passkeys the server asks
// for after the password when signing in on a device. Not the same as
// passkey unlock (passkey.ts), which only replaces typing the password on a
// device that is already signed in.

import { api } from './api'
import { authKeyFor } from './session'
import {
  creationJSON,
  creationOptions,
  type CreationOptionsJSON,
} from './webauthn'

export interface SignInPasskey {
  id: string
  label: string
  /** The host it works on: passkeys made on preview don't work on production. */
  site: string
  createdAt: string
  lastUsedAt: string | null
}

export async function listSignInPasskeys(): Promise<SignInPasskey[]> {
  return (await api<{ passkeys: SignInPasskey[] }>('GET', '/account/passkeys'))
    .passkeys
}

/** Create a passkey and require it at sign-in. Needs the password. */
export async function addSignInPasskey(
  label: string,
  password: string,
): Promise<void> {
  // The server checks the password here, before the authenticator makes a
  // passkey, so a typo doesn't leave an unused passkey behind.
  const { token, options } = await api<{
    token: string
    options: CreationOptionsJSON
  }>('POST', '/account/passkeys/options', {
    currentAuthKey: await authKeyFor(password),
  })
  let cred: Credential | null
  try {
    cred = await navigator.credentials.create({
      publicKey: creationOptions(options),
    })
  } catch {
    cred = null
  }
  if (!cred) throw new Error('No passkey was added.')
  await api('POST', '/account/passkeys', {
    token,
    credential: creationJSON(cred as PublicKeyCredential),
    label,
  })
}

/** Stop requiring this passkey at sign-in. Needs the password. */
export async function removeSignInPasskey(
  id: string,
  password: string,
): Promise<void> {
  await api('DELETE', `/account/passkeys/${encodeURIComponent(id)}`, {
    currentAuthKey: await authKeyFor(password),
  })
}

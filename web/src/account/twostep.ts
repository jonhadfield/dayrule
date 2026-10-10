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

// ---------------------------------------------------------------------------
// Authenticator app (TOTP) and backup codes

export interface TwoStepStatus {
  passkeys: number
  totp: { addedAt: string; lastUsedAt: string | null } | null
  backupCodes: number
}

export function twoStepStatus(): Promise<TwoStepStatus> {
  return api<TwoStepStatus>('GET', '/account/two-step')
}

/**
 * Start setting up an authenticator app: a new secret, as text and as an
 * otpauth:// URI for a QR code. Nothing changes until confirmTotp.
 */
export async function startTotp(
  password: string,
): Promise<{ secret: string; uri: string }> {
  return api('POST', '/account/totp/start', {
    currentAuthKey: await authKeyFor(password),
  })
}

/** Turn the authenticator app on with a code from it. */
export async function confirmTotp(code: string): Promise<void> {
  await api('POST', '/account/totp', { code })
}

export async function removeTotp(password: string): Promise<void> {
  await api('DELETE', '/account/totp', {
    currentAuthKey: await authKeyFor(password),
  })
}

/** New backup codes, replacing any old ones. Shown once. */
export async function makeBackupCodes(password: string): Promise<string[]> {
  return (
    await api<{ codes: string[] }>('POST', '/account/backup-codes', {
      currentAuthKey: await authKeyFor(password),
    })
  ).codes
}

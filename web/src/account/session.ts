// Account flows (PLAN.md §10.2, decisions 4–7): sign-up, sign-in, unlock,
// recovery, lock and sign-out. Keys stay in the crypto worker; this module
// only moves wrapped keys and AuthKeys between it and the server.

import Dexie from 'dexie'
import { create } from 'zustand'
import { dataDbName } from '../persistence/encrypted'
import { keyring } from '../crypto/client'
import type { Credentials, WrappedB64 } from '../crypto/keyring'
import type { KdfParams } from '../crypto/primitives'
import { api, deviceLabel } from './api'
import { checkServerKdf } from './kdf'
import { profiles, type Profile } from './profile'
import {
  requestJSON,
  requestOptions,
  type RequestOptionsJSON,
} from './webauthn'

export type AccountStatus = 'loading' | 'signed-out' | 'locked' | 'unlocked'

interface AccountState {
  status: AccountStatus
  profile: Profile | null
  /** Just signed up: suggest a second step for sign-in (decision 30). */
  suggestTwoStep: boolean
}

export const useAccount = create<AccountState>(() => ({
  status: 'loading',
  profile: null,
  suggestTwoStep: false,
}))

const set = (s: Partial<AccountState>) => useAccount.setState(s)

/** At start-up: unlocked from the device key, locked, or signed out. */
export async function resume(): Promise<void> {
  const profile = (await profiles.get()) ?? null
  if (!profile) return set({ status: 'signed-out', profile: null })
  if (profile.remember && (await keyring().unlockFromDevice(profile.userId))) {
    return set({ status: 'unlocked', profile })
  }
  set({ status: 'locked', profile })
}

async function finishUnlock(profile: Omit<Profile, 'key'>, remember: boolean) {
  const k = keyring()
  if (remember) await k.rememberDevice()
  else await k.forgetDevice(profile.userId)
  await profiles.save({ ...profile, remember })
  set({ status: 'unlocked', profile: { key: 'current', ...profile, remember } })
}

// ---------------------------------------------------------------------------
// Sign-up (decision 4): email code first, keys created after the recovery
// phrase has been confirmed, then the account is registered.

export async function signUpStart(
  email: string,
  inviteCode: string,
): Promise<void> {
  await api('POST', '/auth/signup/start', { email, inviteCode })
}

export async function signUpVerify(
  email: string,
  code: string,
): Promise<string> {
  const r = await api<{ signupToken: string }>('POST', '/auth/signup/verify', {
    email,
    code,
  })
  return r.signupToken
}

export interface PendingAccount {
  userId: string
  creds: Credentials
  wrappedRecovery: WrappedB64
  recoveryProof: string
  recoveryWords: string[]
}

/** Create keys in the worker. The account isn't registered yet. */
export async function prepareAccount(
  password: string,
): Promise<PendingAccount> {
  const userId = crypto.randomUUID()
  const a = await keyring().createAccount(password, userId)
  return {
    userId,
    creds: {
      salt: a.salt,
      kdf: a.kdf,
      authKey: a.authKey,
      wrappedPassword: a.wrappedPassword,
    },
    wrappedRecovery: a.wrappedRecovery,
    recoveryProof: a.recoveryProof,
    recoveryWords: a.recoveryWords,
  }
}

export async function register(
  email: string,
  signupToken: string,
  inviteCode: string,
  pending: PendingAccount,
  remember: boolean,
): Promise<void> {
  await api('POST', '/auth/register', {
    email,
    signupToken,
    inviteCode,
    userId: pending.userId,
    ...pending.creds,
    wrappedRecovery: pending.wrappedRecovery,
    recoveryProof: pending.recoveryProof,
    deviceLabel: deviceLabel(),
  })
  set({ suggestTwoStep: true })
  await finishUnlock(
    {
      userId: pending.userId,
      email: email.trim().toLowerCase(),
      salt: pending.creds.salt,
      kdf: pending.creds.kdf,
      wrappedPassword: pending.creds.wrappedPassword,
      remember,
    },
    remember,
  )
}

// ---------------------------------------------------------------------------
// Sign-in and unlock

/** The server wants a second step before it signs this device in (decision 30). */
export interface SecondStep {
  token: string
  methods: string[]
  /** When a reset by email will turn two-step sign-in off, if one is pending. */
  resetDueAt?: string | null
}

interface LoginResponse {
  userId: string
  wrappedPassword: WrappedB64
  salt: string
  kdf: KdfParams
}

/**
 * Sign in with the password. Returns the second step if the account has one
 * (then call signInWithPasskey or signInWithCode), or null once this device
 * is unlocked.
 */
export async function signIn(
  email: string,
  password: string,
  remember: boolean,
): Promise<SecondStep | null> {
  const pre = await api<{ salt: string; kdf: KdfParams }>(
    'POST',
    '/auth/prelogin',
    { email },
  )
  checkServerKdf(pre.kdf)
  const authKey = await keyring().beginLogin(password, pre.salt, pre.kdf)
  const r = await api<LoginResponse | { secondStep: SecondStep }>(
    'POST',
    '/auth/login',
    { email, authKey, deviceLabel: deviceLabel() },
  )
  if ('secondStep' in r) return r.secondStep
  await finishSignIn(r, email, remember)
  return null
}

/**
 * The second step with a passkey the server verifies. The password from
 * signIn is still held by the crypto worker, so the account key unwraps as
 * soon as the server hands it over. Can be retried while the step lasts.
 */
export async function signInWithPasskey(
  step: SecondStep,
  email: string,
  remember: boolean,
): Promise<void> {
  const { options } = await api<{ options: RequestOptionsJSON }>(
    'POST',
    '/auth/login/passkey/options',
    { token: step.token },
  )
  let cred: Credential | null
  try {
    cred = await navigator.credentials.get({
      publicKey: requestOptions(options),
    })
  } catch {
    cred = null
  }
  if (!cred)
    throw new Error(
      'The passkey wasn’t used. Try again, or reset your password with your recovery phrase.',
    )
  const r = await api<LoginResponse>('POST', '/auth/login/passkey', {
    token: step.token,
    credential: requestJSON(cred as PublicKeyCredential),
  })
  await finishSignIn(r, email, remember)
}

/**
 * The second step with a code from an authenticator app, or a backup code.
 * Like signInWithPasskey, the password is still in the crypto worker.
 */
export async function signInWithCode(
  step: SecondStep,
  email: string,
  remember: boolean,
  code: string,
): Promise<void> {
  const r = await api<LoginResponse>('POST', '/auth/login/code', {
    token: step.token,
    code,
  })
  await finishSignIn(r, email, remember)
}

async function finishSignIn(
  r: LoginResponse,
  email: string,
  remember: boolean,
): Promise<void> {
  // Cached on this device for offline unlock, so it gets the same check as
  // prelogin's, whichever step signed in.
  checkServerKdf(r.kdf)
  await keyring().finishLogin(r.userId, r.wrappedPassword)
  await finishUnlock(
    {
      userId: r.userId,
      email: email.trim().toLowerCase(),
      salt: r.salt,
      kdf: r.kdf,
      wrappedPassword: r.wrappedPassword,
      remember,
    },
    remember,
  )
}

/**
 * Finish unlocking after another method (a passkey) has put the account
 * key in the worker.
 */
export async function completeUnlock(remember: boolean): Promise<void> {
  const profile = useAccount.getState().profile
  if (!profile) throw new Error('Not signed in on this device.')
  await finishUnlock(profile, remember)
}

/** Unlock on this device with the password; works offline. */
export async function unlock(
  password: string,
  remember: boolean,
): Promise<void> {
  const profile = useAccount.getState().profile
  if (!profile) throw new Error('Not signed in on this device.')
  checkServerKdf(profile.kdf)
  const k = keyring()
  await k.beginLogin(password, profile.salt, profile.kdf)
  try {
    await k.finishLogin(profile.userId, profile.wrappedPassword)
  } catch {
    throw new Error('That password isn’t right.')
  }
  await finishUnlock(profile, remember)
}

// ---------------------------------------------------------------------------
// Recovery (decision 6)

export async function recover(
  email: string,
  words: string,
  newPassword: string,
  remember: boolean,
): Promise<void> {
  const k = keyring()
  const recoveryProof = await k.recoveryProof(words)
  const start = await api<{ userId: string; wrappedRecovery: WrappedB64 }>(
    'POST',
    '/auth/recover/start',
    {
      email,
      recoveryProof,
    },
  )
  const creds = await k.recover(
    words,
    start.userId,
    start.wrappedRecovery,
    newPassword,
  )
  await api('POST', '/auth/recover/complete', {
    email,
    recoveryProof,
    ...creds,
    deviceLabel: deviceLabel(),
  })
  await finishUnlock(
    {
      userId: start.userId,
      email: email.trim().toLowerCase(),
      salt: creds.salt,
      kdf: creds.kdf,
      wrappedPassword: creds.wrappedPassword,
      remember,
    },
    remember,
  )
}

// ---------------------------------------------------------------------------
// Lock and sign out

/**
 * Lock: forget the key and reload, which also wipes every decrypted to-do
 * from memory. The encrypted data stays on the device.
 */
export async function lock(): Promise<void> {
  await keyring().lock()
  window.location.assign('/')
}

/**
 * Sign out: end the server session and forget this device. The encrypted
 * data is kept: until sync (M4) it's the only copy of the to-dos.
 */
export function dismissTwoStepSuggestion(): void {
  set({ suggestTwoStep: false })
}

export async function signOut(): Promise<void> {
  const profile = useAccount.getState().profile
  await api('POST', '/auth/logout').catch(() => undefined)
  if (profile) await keyring().forgetDevice(profile.userId)
  await keyring().lock()
  await profiles.clear()
  window.location.assign('/')
}

// ---------------------------------------------------------------------------
// Account settings (decisions 5, 6, 19)

function currentProfile(): Profile {
  const p = useAccount.getState().profile
  if (!p) throw new Error('Not signed in.')
  return p
}

/** The AuthKey for a password, to prove it to the server. */
export async function authKeyFor(password: string): Promise<string> {
  const p = currentProfile()
  checkServerKdf(p.kdf)
  return keyring().beginLogin(password, p.salt, p.kdf)
}

export async function changePassword(
  current: string,
  next: string,
): Promise<void> {
  const currentAuthKey = await authKeyFor(current)
  const creds = await keyring().changePassword(next)
  await api('PUT', '/account/password', { currentAuthKey, ...creds })
  const patch = {
    salt: creds.salt,
    kdf: creds.kdf,
    wrappedPassword: creds.wrappedPassword,
  }
  await profiles.update(patch)
  useAccount.setState((s) => ({
    profile: s.profile ? { ...s.profile, ...patch } : null,
  }))
}

export async function changeEmailStart(
  newEmail: string,
  password: string,
): Promise<void> {
  await api('POST', '/account/email/start', {
    newEmail,
    currentAuthKey: await authKeyFor(password),
  })
}

export async function changeEmailVerify(
  newEmail: string,
  code: string,
): Promise<void> {
  const r = await api<{ email: string }>('POST', '/account/email/verify', {
    newEmail,
    code,
  })
  await profiles.update({ email: r.email })
  useAccount.setState((s) => ({
    profile: s.profile ? { ...s.profile, email: r.email } : null,
  }))
}

export interface DeviceSession {
  id: string
  deviceLabel: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export async function listSessions(): Promise<DeviceSession[]> {
  return (await api<{ sessions: DeviceSession[] }>('GET', '/account/sessions'))
    .sessions
}

export async function revokeSession(id: string): Promise<void> {
  await api('DELETE', `/account/sessions/${id}`)
}

export async function setRemember(remember: boolean): Promise<void> {
  const p = currentProfile()
  if (remember) await keyring().rememberDevice()
  else await keyring().forgetDevice(p.userId)
  await profiles.update({ remember })
  useAccount.setState((s) => ({
    profile: s.profile ? { ...s.profile, remember } : null,
  }))
}

/** Delete the account on the server and everything on this device. */
export async function deleteAccount(password: string): Promise<void> {
  const p = currentProfile()
  await api('DELETE', '/account', { authKey: await authKeyFor(password) })
  await keyring().forgetDevice(p.userId)
  await keyring().lock()
  await profiles.clear()
  await Dexie.delete(dataDbName(p.userId))
  window.location.assign('/')
}

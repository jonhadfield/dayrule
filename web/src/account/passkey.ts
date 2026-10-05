// Passkey unlock on this device (PLAN.md §10.2, M6). WebAuthn's PRF
// extension makes the authenticator compute a secret from a salt we keep;
// the crypto worker turns it into a key that wraps the account key. The
// server isn't involved: this replaces typing the password on this device,
// and the password stays the fallback (and is needed on new devices).

import { keyring } from '../crypto/client'
import { profiles, type Profile } from './profile'
import { completeUnlock, useAccount } from './session'

const toB64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

interface PrfResults {
  enabled?: boolean
  results?: { first?: ArrayBuffer }
}
const prfOf = (cred: Credential | null) =>
  (cred as PublicKeyCredential | null)?.getClientExtensionResults() as
    { prf?: PrfResults } | undefined

export class PasskeyError extends Error {}

const UNSUPPORTED =
  'This device or browser can’t unlock with a passkey (it needs passkeys with the PRF extension).'

export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window
}

/** Ask the authenticator for its PRF output for our salt. */
async function prfOutput(
  credentialId: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  let cred: Credential | null
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        // Unused: nothing verifies this assertion; only the PRF output matters.
        challenge: random(32),
        allowCredentials: [
          { type: 'public-key', id: credentialId as BufferSource },
        ],
        userVerification: 'required',
        extensions: {
          prf: { eval: { first: salt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })
  } catch {
    throw new PasskeyError(
      'The passkey wasn’t used, or isn’t on this device any more. You can unlock with your password.',
    )
  }
  const out = prfOf(cred)?.prf?.results?.first
  if (!out) throw new PasskeyError(UNSUPPORTED)
  return new Uint8Array(out)
}

function current(): Profile {
  const p = useAccount.getState().profile
  if (!p) throw new Error('Not signed in on this device.')
  return p
}

async function savePasskey(passkey: Profile['passkey']) {
  await profiles.update({ passkey })
  const p = current()
  useAccount.setState({ profile: { ...p, passkey } })
}

/** Create a passkey and use it to unlock this device from now on. */
export async function enablePasskey(): Promise<void> {
  const p = current()
  const salt = random(32)
  let cred: Credential | null
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Dayrule' }, // the exact host (§14): previews can't use production passkeys
        user: {
          id: new TextEncoder().encode(p.userId),
          name: p.email,
          displayName: p.email,
        },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -8 },
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        extensions: {
          prf: { eval: { first: salt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })
  } catch {
    throw new PasskeyError('No passkey was created.')
  }
  if (!cred) throw new PasskeyError('No passkey was created.')
  const ext = prfOf(cred)?.prf
  if (!ext?.enabled && !ext?.results?.first) throw new PasskeyError(UNSUPPORTED)
  const id = new Uint8Array((cred as PublicKeyCredential).rawId)
  // Some authenticators evaluate the PRF only when the passkey is used.
  const prf = ext.results?.first
    ? new Uint8Array(ext.results.first)
    : await prfOutput(id, salt)
  const wrapped = await keyring().wrapForPrf(prf)
  await savePasskey({ credentialId: toB64(id), salt: toB64(salt), wrapped })
}

/** Stop unlocking with the passkey here (the passkey itself stays in the authenticator). */
export async function disablePasskey(): Promise<void> {
  await savePasskey(undefined)
}

/** Unlock this device with the passkey; works offline. */
export async function unlockWithPasskey(remember: boolean): Promise<void> {
  const p = current()
  if (!p.passkey)
    throw new PasskeyError('Passkey unlock isn’t set up on this device.')
  const prf = await prfOutput(
    fromB64(p.passkey.credentialId),
    fromB64(p.passkey.salt),
  )
  try {
    await keyring().unlockWithPrf(p.userId, prf, p.passkey.wrapped)
  } catch {
    throw new PasskeyError('That passkey can’t unlock this account.')
  }
  await completeUnlock(remember)
}

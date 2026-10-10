// WebAuthn options and credentials as JSON, for passkeys the server verifies
// (two-step sign-in, decision 30). The server sends options with binary
// fields as base64url; the browser API wants ArrayBuffers, and its results go
// back as base64url. Written out by hand rather than with
// PublicKeyCredential.parseCreationOptionsFromJSON / toJSON(), which not
// every browser Dayrule supports has.

const toB64url = (b: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    b instanceof ArrayBuffer
      ? new Uint8Array(b)
      : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const fromB64url = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer
}

interface DescriptorJSON {
  type: 'public-key'
  id: string
  transports?: AuthenticatorTransport[]
}

const descriptor = (d: DescriptorJSON): PublicKeyCredentialDescriptor => ({
  ...d,
  id: fromB64url(d.id),
})

/** Registration options, as the server sends them under `publicKey`. */
export interface CreationOptionsJSON {
  publicKey: Omit<
    PublicKeyCredentialCreationOptions,
    'challenge' | 'user' | 'excludeCredentials'
  > & {
    challenge: string
    user: { id: string; name: string; displayName: string }
    excludeCredentials?: DescriptorJSON[]
  }
}

/** Sign-in options, as the server sends them under `publicKey`. */
export interface RequestOptionsJSON {
  publicKey: Omit<
    PublicKeyCredentialRequestOptions,
    'challenge' | 'allowCredentials'
  > & {
    challenge: string
    allowCredentials?: DescriptorJSON[]
  }
}

export function creationOptions({
  publicKey: o,
}: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...o,
    challenge: fromB64url(o.challenge),
    user: { ...o.user, id: fromB64url(o.user.id) },
    excludeCredentials: o.excludeCredentials?.map(descriptor),
  }
}

export function requestOptions({
  publicKey: o,
}: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...o,
    challenge: fromB64url(o.challenge),
    allowCredentials: o.allowCredentials?.map(descriptor),
  }
}

function common(cred: PublicKeyCredential) {
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: {},
  }
}

/** A new credential, as the server parses it. */
export function creationJSON(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    ...common(cred),
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      attestationObject: toB64url(r.attestationObject),
      transports: r.getTransports?.() ?? [],
    },
  }
}

/** An assertion, as the server parses it. */
export function requestJSON(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    ...common(cred),
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
    },
  }
}

export const forTesting = { toB64url, fromB64url }

import { describe, expect, it } from 'vitest'
import {
  creationJSON,
  creationOptions,
  forTesting,
  requestJSON,
  requestOptions,
} from './webauthn'

const { toB64url, fromB64url } = forTesting
const bytes = (...b: number[]) => new Uint8Array(b)
const view = (b: ArrayBuffer | ArrayBufferView | undefined) =>
  Array.from(
    b instanceof ArrayBuffer
      ? new Uint8Array(b)
      : new Uint8Array(b!.buffer, b!.byteOffset, b!.byteLength),
  )

describe('base64url', () => {
  it('round-trips every padding length, with no padding or +/', () => {
    for (const n of [0, 1, 2, 3, 4, 31, 32]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 251) % 256)
      const s = toB64url(b)
      expect(s).not.toMatch(/[+/=]/)
      expect(view(fromB64url(s))).toEqual(Array.from(b))
    }
  })

  it('encodes a view of part of a buffer, not the whole buffer', () => {
    const whole = bytes(1, 2, 3, 4, 5)
    expect(toB64url(whole.subarray(1, 3))).toBe(toB64url(bytes(2, 3)))
  })

  it('uses the url alphabet', () => {
    expect(toB64url(bytes(0xfb, 0xff))).toBe('-_8')
  })
})

describe('options from the server', () => {
  it('decodes the registration challenge, user id and exclusions', () => {
    const o = creationOptions({
      publicKey: {
        rp: { id: 'dayrule.app', name: 'Dayrule' },
        user: { id: toB64url(bytes(9, 9)), name: 'a@x', displayName: 'a@x' },
        challenge: toB64url(bytes(1, 2, 3)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        excludeCredentials: [
          { type: 'public-key', id: toB64url(bytes(7)), transports: ['usb'] },
        ],
      },
    })
    expect(view(o.challenge as ArrayBuffer)).toEqual([1, 2, 3])
    expect(view(o.user.id as ArrayBuffer)).toEqual([9, 9])
    expect(o.user.name).toBe('a@x')
    expect(o.rp.id).toBe('dayrule.app')
    expect(view(o.excludeCredentials![0]!.id as ArrayBuffer)).toEqual([7])
    expect(o.excludeCredentials![0]!.transports).toEqual(['usb'])
  })

  it('decodes the sign-in challenge and allowed credentials', () => {
    const o = requestOptions({
      publicKey: {
        challenge: toB64url(bytes(4, 5)),
        rpId: 'dayrule.app',
        userVerification: 'preferred',
        allowCredentials: [{ type: 'public-key', id: toB64url(bytes(8, 8)) }],
      },
    })
    expect(view(o.challenge as ArrayBuffer)).toEqual([4, 5])
    expect(view(o.allowCredentials![0]!.id as ArrayBuffer)).toEqual([8, 8])
    expect(o.userVerification).toBe('preferred')
  })
})

describe('credentials to the server', () => {
  const base = {
    id: toB64url(bytes(6, 6)),
    rawId: bytes(6, 6).buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
  }

  it('encodes a new credential', () => {
    const cred = {
      ...base,
      response: {
        clientDataJSON: bytes(1).buffer,
        attestationObject: bytes(2).buffer,
        getTransports: () => ['internal'],
      },
    } as unknown as PublicKeyCredential
    expect(creationJSON(cred)).toEqual({
      id: base.id,
      rawId: base.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: toB64url(bytes(1)),
        attestationObject: toB64url(bytes(2)),
        transports: ['internal'],
      },
    })
  })

  it('encodes an assertion', () => {
    const cred = {
      ...base,
      authenticatorAttachment: null,
      response: {
        clientDataJSON: bytes(1).buffer,
        authenticatorData: bytes(2).buffer,
        signature: bytes(3).buffer,
        userHandle: null,
      },
    } as unknown as PublicKeyCredential
    const json = requestJSON(cred)
    expect(json.response).toEqual({
      clientDataJSON: toB64url(bytes(1)),
      authenticatorData: toB64url(bytes(2)),
      signature: toB64url(bytes(3)),
      userHandle: undefined,
    })
    expect(json.authenticatorAttachment).toBeUndefined()
  })
})

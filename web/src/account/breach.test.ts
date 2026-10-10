import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBreached, RANGE_URL } from './breach'

afterEach(() => vi.unstubAllGlobals())

// Node's SHA-1, as a cross-check on the WebCrypto one in breach.ts.
const HASH = createHash('sha1').update('password').digest('hex').toUpperCase()
const PREFIX = HASH.slice(0, 5)
const SUFFIX = HASH.slice(5)

function serve(body: string, status = 200) {
  const fetch = vi.fn(async () => new Response(body, { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('isBreached', () => {
  it('sends only the 5-character prefix, with padding asked for', async () => {
    const fetch = serve('')
    await isBreached('password')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(RANGE_URL + PREFIX)
    expect(init.headers).toEqual({ 'Add-Padding': 'true' })
    expect(init.credentials).toBe('omit')
    expect(JSON.stringify(init)).not.toContain(SUFFIX)
  })

  it('finds a breached password in the range', async () => {
    serve(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:52256179\r\n`)
    expect(await isBreached('password')).toBe(true)
  })

  it('ignores padding lines, which have a count of 0', async () => {
    serve(`${SUFFIX}:0\r\n`)
    expect(await isBreached('password')).toBe(false)
  })

  it('passes a password that isn’t in the range', async () => {
    serve('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n')
    expect(await isBreached('password')).toBe(false)
  })

  it('fails open on an error response', async () => {
    serve(`${SUFFIX}:5`, 503)
    expect(await isBreached('password')).toBe(false)
  })

  it('fails open when the network fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await isBreached('password')).toBe(false)
  })

  it('fails open when the API is too slow', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(init.signal!.reason),
          ),
        ),
    )
    expect(await isBreached('password', 20)).toBe(false)
  })
})

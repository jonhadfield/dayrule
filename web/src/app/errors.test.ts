import { afterEach, describe, expect, it, vi } from 'vitest'
import { installErrorReporting, reportError } from './errors'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit]

function stubFetch() {
  const calls: FetchArgs[] = []
  vi.stubGlobal('fetch', async (...args: FetchArgs) => {
    calls.push(args)
    return new Response(null, { status: 204 })
  })
  return calls
}

describe('reportError', () => {
  it('posts message, stack and release', () => {
    const calls = stubFetch()

    const err = new Error('boom')
    err.stack = 'Error: boom\n    at main'
    reportError(err, 'abc123')

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe('/api/v1/errors')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      release: 'abc123',
      message: 'boom',
      stack: 'Error: boom\n    at main',
    })
  })

  it('skips empty messages and swallows fetch failures', async () => {
    const calls: FetchArgs[] = []
    vi.stubGlobal('fetch', async (...args: FetchArgs) => {
      calls.push(args)
      throw new Error('offline')
    })

    reportError('   ')
    expect(calls).toHaveLength(0)

    reportError('still report')
    await Promise.resolve()
    expect(calls).toHaveLength(1)
  })

  it('clips oversized payloads', () => {
    const calls = stubFetch()

    const long = new Error('z'.repeat(3000))
    long.stack = 's'.repeat(20_000)
    reportError(long, 'r'.repeat(200))
    const body = JSON.parse(String(calls[0]![1]?.body)) as {
      release: string
      message: string
      stack: string
    }
    expect(body.release).toHaveLength(128)
    expect(body.message).toHaveLength(2 << 10)
    expect(body.stack).toHaveLength(12 << 10)
  })
})

describe('installErrorReporting', () => {
  it('forwards window error and rejection events', async () => {
    const calls = stubFetch()
    installErrorReporting()

    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('from-handler'),
        message: 'x',
      }),
    )
    // jsdom lacks PromiseRejectionEvent; fire a plain Event with reason.
    const rejection = new Event('unhandledrejection') as Event & {
      reason: string
    }
    rejection.reason = 'rejected'
    window.dispatchEvent(rejection)
    await Promise.resolve()

    const bodies = calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'from-handler' }),
        expect.objectContaining({ message: 'rejected' }),
      ]),
    )
  })
})

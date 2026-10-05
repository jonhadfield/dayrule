import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify(body), { status, headers }),
  )
}

describe('api errors', () => {
  it('passes on our API’s message', async () => {
    respond(400, { error: 'That invite code isn’t valid.', code: 'bad_invite' })
    await expect(api('POST', '/auth/signup/start', {})).rejects.toMatchObject({
      status: 400,
      code: 'bad_invite',
      message: 'That invite code isn’t valid.',
    })
  })

  it('explains a Firewall rate limit instead of showing its body', async () => {
    respond(
      403,
      { error: { code: '403', message: 'Forbidden' } },
      { 'x-vercel-mitigated': 'deny' },
    )
    const err = await api('POST', '/auth/login', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      code: 'rate_limited',
      message: expect.stringMatching(/Too many attempts/),
    })
  })

  it('never uses a non-text error as the message', async () => {
    respond(500, { error: { nested: true } })
    await expect(api('GET', '/x')).rejects.toMatchObject({
      message: 'Something went wrong.',
    })
  })
})

// @vitest-environment node
// The production security headers (PLAN.md §10.7) live in vercel.json.
// These tests stop them being weakened by accident.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Rule {
  source: string
  has?: unknown
  missing?: unknown
  headers: { key: string; value: string }[]
}
const vercel = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as {
  headers: Rule[]
  crons?: { path: string; schedule: string }[]
}
const global = vercel.headers.find(
  (r) => r.source === '/(.*)' && !r.has && !r.missing,
)!
const header = (key: string) =>
  global.headers.find((h) => h.key === key)?.value ?? ''

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!, values]),
  )
}

const PWNED = 'https://api.pwnedpasswords.com'

describe('security headers', () => {
  const csp = directives(header('Content-Security-Policy'))

  it('allows only our own scripts, and no inline or eval', () => {
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    for (const [name, values] of csp) {
      expect(values, name).not.toContain("'unsafe-inline'")
      expect(values, name).not.toContain("'unsafe-eval'")
      // The one third-party origin: the breached-password check's data
      // fetch (decision 31), allowed only in connect-src.
      const allowed = name === 'connect-src' ? [PWNED] : []
      expect(
        values.some(
          (v) => v === '*' || (v.startsWith('http') && !allowed.includes(v)),
        ),
        name,
      ).toBe(false)
    }
  })

  it('locks down everything else', () => {
    expect(csp.get('connect-src')).toEqual(["'self'", PWNED])
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'none'"])
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.get('form-action')).toEqual(["'self'"])
  })

  it('enforces Trusted Types with only our worker policy', () => {
    expect(csp.get('require-trusted-types-for')).toEqual(["'script'"])
    expect(csp.get('trusted-types')).toEqual(['dayrule-worker'])
  })

  it('sends the other hardening headers', () => {
    expect(header('Strict-Transport-Security')).toMatch(
      /max-age=\d{8,}; includeSubDomains; preload/,
    )
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('no-referrer')
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(header('Permissions-Policy')).toContain('camera=()')
  })

  it('isolates the page from other origins', () => {
    // With COOP, this makes the page cross-origin isolated: no other
    // origin's content shares its process (key material is in memory).
    expect(header('Cross-Origin-Embedder-Policy')).toBe('require-corp')
    expect(header('Cross-Origin-Resource-Policy')).toBe('same-origin')
  })

  it('never caches the page or the service worker', () => {
    const rule = vercel.headers.find((r) => r.source.includes('sw.js'))!
    expect(rule.source).toContain('index.html')
    expect(rule.headers.find((h) => h.key === 'Cache-Control')?.value).toBe(
      'no-cache',
    )
  })

  it('has no inline scripts in the page', () => {
    const html = readFileSync(
      new URL('../../index.html', import.meta.url),
      'utf8',
    )
    for (const tag of html.match(/<script\b[^>]*>/g) ?? [])
      expect(tag).toMatch(/\ssrc=/)
  })

  it('serves apple-app-site-association as JSON (native webcredentials)', () => {
    const rule = vercel.headers.find(
      (r) => r.source === '/.well-known/apple-app-site-association',
    )!
    expect(rule.headers.find((h) => h.key === 'Content-Type')?.value).toBe(
      'application/json',
    )
    const aasa = JSON.parse(
      readFileSync(
        new URL('../../public/.well-known/apple-app-site-association', import.meta.url),
        'utf8',
      ),
    ) as { webcredentials?: { apps?: string[] } }
    expect(aasa.webcredentials?.apps).toEqual([
      'VBZY8FBYR5.uk.co.lessknown.dayrule',
    ])
  })
})

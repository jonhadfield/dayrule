// @vitest-environment node
// WCAG AA contrast (PLAN.md §16) for the design tokens, in both themes:
// text colours against every background they're used on.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  )
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Mix `top` at `alpha` over `under`, for the translucent tints we use. */
function mix(top: string, under: string, alpha: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(ch(top, i) * alpha + ch(under, i) * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

const TEXT = [
  'text',
  'text-secondary',
  'accent',
  'today',
  'scheduled',
  'ready',
  'later',
  'deadline',
]

describe.each([
  ['light', block(':root {')],
  ['dark', block(":root[data-theme='dark']")],
])('%s theme', (_, t) => {
  // Paper, sidebar, a selected row (accent at 10%) and a hovered row.
  const backgrounds = {
    bg: t.bg!,
    sidebar: t.sidebar!,
    selected: mix(t.accent!, t.bg!, 0.1),
    hover: mix(t.sidebar!, t.bg!, 0.6),
  }
  it.each(TEXT)('%s text is at least 4.5:1 on every background', (name) => {
    for (const [where, bg] of Object.entries(backgrounds)) {
      expect(
        contrast(t[name]!, bg),
        `${name} on ${where}`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('paper text on accent buttons is at least 4.5:1', () => {
    expect(contrast(t.bg!, t.accent!)).toBeGreaterThanOrEqual(4.5)
  })
})

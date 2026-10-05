// Accessibility checks shared by the a11y specs.

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

export type Found = {
  screen: string
  id: string
  impact: string
  help: string
  nodes: string[]
}

export async function audit(page: Page, screen: string, found: Found[]) {
  // Let animations finish so colours and contrast are final.
  await page.waitForTimeout(400)
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  for (const v of result.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue
    found.push({
      screen,
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => {
        const why = (n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ''
        return `${n.target.join(' ')} ${n.html.slice(0, 90)} — ${why.slice(0, 140)}`
      }),
    })
  }
}

export function report(found: Found[]) {
  return found
    .map(
      (f) =>
        `${f.screen}: [${f.impact}] ${f.id} — ${f.help}\n    ${f.nodes.join('\n    ')}`,
    )
    .join('\n')
}

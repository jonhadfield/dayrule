// Accessibility on mobile (PLAN.md §16): no serious or critical WCAG 2
// A/AA violations in the phone layout, editor and sheets.

import { devices, expect, test } from '@playwright/test'
import { audit, report, type Found } from './axe'
import { add, signUp } from './helpers'

test.use({ ...devices['Pixel 7'] })

test('mobile screens have no serious accessibility problems', async ({
  page,
}) => {
  const found: Found[] = []
  await signUp(page, `a11y-m-${Date.now()}@example.com`)
  await audit(page, 'lists (mobile)', found)
  await page.getByRole('link', { name: 'Inbox' }).tap()
  await add(page, 'Check the boiler')
  await audit(page, 'inbox (mobile)', found)
  await page.getByText('Check the boiler').tap()
  await audit(page, 'editor (mobile)', found)
  await page.getByRole('button', { name: 'When' }).tap()
  await audit(page, 'when sheet (mobile)', found)
  expect(found, report(found)).toEqual([])
})

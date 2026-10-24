// Visible Undo bar after Complete (PLAN.md §7.1, decision 33).

import { expect, test } from '@playwright/test'
import { add, signUp } from './helpers'

test('completing a to-do shows Undo, which puts it back', async ({ page }) => {
  await signUp(page, `undo-${Date.now()}@example.com`)
  await add(page, 'Milk')

  await page.getByRole('checkbox', { name: 'Complete Milk' }).click()
  await expect(
    page.getByRole('status', { name: 'Completed Milk' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()

  await expect(
    page.getByRole('status', { name: 'Completed Milk' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('checkbox', { name: 'Complete Milk' }),
  ).toHaveAttribute('aria-checked', 'false')
})

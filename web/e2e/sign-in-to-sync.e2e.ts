// Session 401 keeps the vault open (PLAN.md §11.4, decision 35).

import { expect, test } from '@playwright/test'
import { add, PASSWORD, signUp } from './helpers'

test('expired session keeps lists and asks to sign in to sync', async ({
  page,
}) => {
  await signUp(page, `session-${Date.now()}@example.com`)
  await add(page, 'Stays on this device')

  // End the cookie without going through Sign out, so local keys and lists
  // stay. The next sync then gets 401.
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Dayrule-Client': 'web' },
    })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect(page.getByText('On this device only')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Stays on this device')).toBeVisible()

  await page.getByRole('button', { name: 'Sign in to sync' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Sign in to sync' }),
  ).toBeVisible()
  await page.getByLabel('Password').fill(PASSWORD)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Sign in' })
    .click()

  await expect(page.getByText('On this device only')).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(page.getByText('Stays on this device')).toBeVisible()
})

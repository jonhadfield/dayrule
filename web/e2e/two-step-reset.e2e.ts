// The suggestion after sign-up, and turning two-step sign-in off by email
// (PLAN.md §10.2, decision 30). The 7-day wait itself is covered by the API
// tests, which control the server's clock.

import { expect, test } from '@playwright/test'
import {
  emailCode,
  enterPassword,
  openAccount,
  PASSWORD,
  signOut,
  signUp,
  totp,
} from './helpers'

test('turning two-step sign-in off by email', async ({ page }) => {
  const email = `reset-${Date.now()}@example.com`
  await signUp(page, email, { keepPrompt: true })

  // "Set it up" opens Account at Two-step sign-in.
  await page.getByRole('button', { name: 'Set it up' }).click()
  const account = page.getByRole('dialog', { name: 'Account' })
  await expect(
    account.getByRole('heading', { name: 'Two-step sign-in' }),
  ).toBeInViewport()
  await account
    .getByRole('button', { name: 'Set up an authenticator app' })
    .click()
  const setup = account.getByRole('form', {
    name: 'Set up an authenticator app',
  })
  await setup.getByLabel('Password').fill(PASSWORD)
  await setup.getByRole('button', { name: 'Continue' }).click()
  const secret = (await account.getByTestId('totp-secret').innerText())
    .replace(/\s/g, '')
    .toUpperCase()
  const confirm = account.getByRole('form', {
    name: 'Confirm the authenticator app',
  })
  await confirm.getByLabel('Code from the app').fill(totp(secret))
  await confirm.getByRole('button', { name: 'Turn on' }).click()
  await expect(account.getByText('Authenticator app added.')).toBeVisible()

  // Without the app: ask for the reset by email.
  await signOut(page)
  await enterPassword(page, email)
  await page.getByRole('button', { name: 'Can’t use any of these?' }).click()
  await expect(
    page.getByRole('heading', { name: 'Can’t use your second step?' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  const form = page.getByRole('form', {
    name: 'Confirm turning off two-step sign-in',
  })
  await form.getByLabel('Code from the email').fill('000000')
  await form.getByRole('button', { name: 'Turn off in 7 days' }).click()
  await expect(page.getByRole('alert')).toContainText(/isn.t right/)
  await form.getByLabel('Code from the email').fill(await emailCode(email))
  await form.getByRole('button', { name: 'Turn off in 7 days' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Two-step sign-in will be turned off on',
  )

  // The step still stands meanwhile, and says so; using it cancels the reset.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText('set to turn off on')).toBeVisible()
  await page
    .getByLabel(/^Code from your authenticator app/)
    .fill(totp(secret, 1))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({
    timeout: 30_000,
  })
  const again = await openAccount(page)
  await expect(
    again.getByRole('button', { name: 'Set up an authenticator app' }),
  ).toHaveCount(0)
  await expect(again.getByRole('form', { name: 'Pending reset' })).toHaveCount(
    0,
  )
})

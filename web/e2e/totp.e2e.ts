// Two-step sign-in with an authenticator app and backup codes (PLAN.md
// §10.2, decision 30), against the real API. The test computes the app's
// codes itself (RFC 6238).

import { expect, test, type Page } from '@playwright/test'
import {
  add,
  enterPassword,
  openAccount,
  PASSWORD,
  signOut,
  signUp,
  totp,
} from './helpers'

const inbox = (page: Page) => page.getByRole('link', { name: 'Inbox' })

async function enterCode(page: Page, code: string) {
  await expect(
    page.getByRole('heading', { name: 'Enter your code' }),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByLabel(/^Code from your authenticator app/).fill(code)
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('an authenticator app and backup codes', async ({ page }) => {
  const email = `totp-${Date.now()}@example.com`
  const title = 'Behind a code'
  await signUp(page, email)
  await add(page, title)

  // Set up: the password first, then a code from the app turns it on.
  let account = await openAccount(page)
  await account
    .getByRole('button', { name: 'Set up an authenticator app' })
    .click()
  const setup = account.getByRole('form', {
    name: 'Set up an authenticator app',
  })
  await setup.getByLabel('Password').fill('not the password')
  await setup.getByRole('button', { name: 'Continue' }).click()
  await expect(account.getByRole('alert')).toContainText(/don.t match/)
  await setup.getByLabel('Password').fill(PASSWORD)
  await setup.getByRole('button', { name: 'Continue' }).click()
  await expect(
    account.getByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeVisible({ timeout: 30_000 })
  const secret = (await account.getByTestId('totp-secret').innerText())
    .replace(/\s/g, '')
    .toUpperCase()
  const confirm = account.getByRole('form', {
    name: 'Confirm the authenticator app',
  })
  await confirm.getByLabel('Code from the app').fill('000000')
  await confirm.getByRole('button', { name: 'Turn on' }).click()
  await expect(account.getByRole('alert')).toContainText(/isn.t right/)
  await confirm.getByLabel('Code from the app').fill(totp(secret))
  await confirm.getByRole('button', { name: 'Turn on' }).click()
  await expect(account.getByText('Authenticator app added.')).toBeVisible()

  // Backup codes, shown once.
  await account.getByRole('button', { name: 'Make backup codes' }).click()
  const make = account.getByRole('form', { name: 'Make backup codes' })
  await make.getByLabel('Password').fill(PASSWORD)
  await make.getByRole('button', { name: 'Make codes' }).click()
  const list = account.getByRole('list', { name: 'Backup codes' })
  await expect(list.getByRole('listitem')).toHaveCount(10, { timeout: 30_000 })
  const codes = await list.getByRole('listitem').allInnerTexts()
  await account.getByRole('button', { name: 'I’ve saved them' }).click()
  await expect(account.getByText('10 unused.')).toBeVisible()

  // Signing in now needs a code. The one that turned the app on was used,
  // so the app's next one.
  await signOut(page)
  await enterPassword(page, email)
  await enterCode(page, totp(secret, 1))
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // A backup code works once.
  await signOut(page)
  await enterPassword(page, email)
  await enterCode(page, codes[0]!.toUpperCase())
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })
  await signOut(page)
  await enterPassword(page, email)
  await enterCode(page, codes[0]!)
  await expect(page.getByRole('alert')).toContainText(/isn.t right/)
  await page.getByLabel(/^Code from your authenticator app/).fill(codes[1]!)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })

  // Remove the app (with the password): the backup codes go with it, and
  // the password is enough again.
  account = await openAccount(page)
  await expect(account.getByText('8 unused.', { exact: false })).toBeVisible()
  await account.getByRole('button', { name: 'Remove app' }).click()
  const remove = account.getByRole('form', {
    name: 'Remove the authenticator app',
  })
  await remove.getByLabel('Password').fill(PASSWORD)
  await remove.getByRole('button', { name: 'Remove app' }).click()
  await expect(account.getByText('Signing in now needs only')).toBeVisible({
    timeout: 30_000,
  })
  await expect(account.getByText('Backup codes')).toHaveCount(0)
  await signOut(page)
  await enterPassword(page, email)
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })
})

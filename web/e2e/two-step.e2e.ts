// Two-step sign-in with a passkey (PLAN.md §10.2, decision 30), against the
// real API, with Chrome's virtual authenticator standing in for Touch ID or
// a security key.

import { expect, test, type Page } from '@playwright/test'
import {
  add,
  enterPassword,
  openAccount,
  PASSWORD,
  signOut,
  signUp,
  stubBreachCheck,
} from './helpers'

/** Adds a virtual authenticator; returns how to count its passkeys. */
async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  )
  return async () =>
    (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
      .length
}

const inbox = (page: Page) => page.getByRole('link', { name: 'Inbox' })

test('a passkey as the second sign-in step', async ({ page, browser }) => {
  const email = `two-step-${Date.now()}@example.com`
  const title = 'Behind two locks'
  const passkeys = await addAuthenticator(page)
  await signUp(page, email)
  await add(page, title)

  // Account → Two-step sign-in: a wrong password fails before any prompt.
  let account = await openAccount(page)
  await account.getByRole('button', { name: 'Add a passkey' }).click()
  const addForm = account.getByRole('form', { name: 'Add a sign-in passkey' })
  await addForm.getByLabel('Name (optional)').fill('Test key')
  await addForm.getByLabel('Password').fill('not the password')
  await addForm.getByRole('button', { name: 'Add passkey' }).click()
  await expect(account.getByRole('alert')).toContainText(/don.t match/)
  expect(await passkeys()).toBe(0)
  await addForm.getByLabel('Password').fill(PASSWORD)
  await addForm.getByRole('button', { name: 'Add passkey' }).click()
  await expect(account.getByText('Passkey added.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(account.getByText('Test key')).toBeVisible()
  expect(await passkeys()).toBe(1)

  // Another device: the password alone no longer signs in.
  const other = await (await browser.newContext()).newPage()
  await stubBreachCheck(other)
  await other.goto('/')
  await enterPassword(other, email)
  await expect(
    other.getByRole('heading', { name: 'Use your passkey' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(inbox(other)).toHaveCount(0)

  // This device, which has the passkey: password, then passkey.
  await signOut(page)
  await enterPassword(page, email)
  await page.getByRole('button', { name: 'Use passkey' }).click()
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // Remove it (with the password); then the password is enough again.
  account = await openAccount(page)
  await expect(account.getByText(/Last used/)).toBeVisible()
  await account.getByRole('button', { name: 'Remove' }).click()
  const removeForm = account.getByRole('form', { name: 'Remove Test key' })
  await removeForm.getByLabel('Password').fill(PASSWORD)
  await removeForm.getByRole('button', { name: 'Remove passkey' }).click()
  await expect(account.getByText('Signing in now needs only')).toBeVisible({
    timeout: 30_000,
  })
  await signOut(page)
  await enterPassword(page, email)
  await expect(inbox(page)).toBeVisible({ timeout: 30_000 })
})

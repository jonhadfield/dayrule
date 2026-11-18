// Shared steps for end-to-end tests: accounts and to-dos via the real UI.

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

const OUT = new URL('./.out/', import.meta.url)
export const PASSWORD = 'orange kettle drift'

/** The latest code emailed to an address (logged by the API in tests). */
export async function emailCode(email: string): Promise<string> {
  let code: string | undefined
  await expect
    .poll(() => {
      const lines = readFileSync(new URL('api.log', OUT), 'utf8').split('\n')
      const line = lines.reverse().find((l) => l.includes(`"to":"${email}"`))
      code = line?.match(/Your Dayrule code: (\d{6})/)?.[1]
      return code
    })
    .toBeTruthy()
  return code!
}

/**
 * Answers the breached-password check (decision 31) locally, so tests never
 * call the real Pwned Passwords API. Nothing is breached unless listed as
 * SHA-1 suffixes (characters 6–40, uppercase).
 */
export async function stubBreachCheck(page: Page, breached: string[] = []) {
  await page.route('https://api.pwnedpasswords.com/range/*', (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      body: breached.map((s) => `${s}:3`).join('\r\n'),
    }),
  )
}

/**
 * Signs up through the UI and returns the 24-word recovery phrase. The
 * suggestion to add a second step is dismissed unless keepPrompt is set.
 */
export async function signUp(
  page: Page,
  email: string,
  { keepPrompt = false } = {},
): Promise<string[]> {
  await stubBreachCheck(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill(await emailCode(email))
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()

  const items = page
    .getByRole('heading', { name: 'Your recovery phrase' })
    .locator('..')
    .getByRole('listitem')
  await expect(items).toHaveCount(24, { timeout: 30_000 })
  const words = (await items.allInnerTexts()).map(
    (t) => t.trim().split(/\s+/)[1]!,
  )
  await page.getByRole('button', { name: 'I’ve written them down' }).click()
  for (const box of await page
    .getByRole('textbox', { name: /^Word \d+$/ })
    .all()) {
    const n = Number(
      (await box.getAttribute('aria-label')) ?? (await labelOf(box)),
    )
    await box.fill(words[n - 1]!)
  }
  await page.getByRole('button', { name: 'Create account' }).click()
  const prompt = page.getByRole('dialog', {
    name: 'Add a second step to sign-in?',
  })
  await expect(prompt).toBeVisible({ timeout: 30_000 })
  if (keepPrompt) return words
  await prompt.getByRole('button', { name: 'Not now' }).click()
  // The sidebar on desktop, the lists screen on mobile.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({
    timeout: 30_000,
  })
  return words
}

async function labelOf(box: ReturnType<Page['getByRole']>): Promise<string> {
  const id = await box.getAttribute('id')
  const text = await box.page().locator(`label[for="${id}"]`).innerText()
  return text.replace(/\D/g, '')
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The sidebar on desktop, the lists screen on mobile.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({
    timeout: 30_000,
  })
}

export async function add(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add to-do' }).click()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.getByText(title, { exact: true })).toBeVisible()
}

/** Sidebar Settings (desktop also has chrome Settings in the detail pane). */
export function settingsButton(page: Page) {
  return page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('button', { name: 'Settings' })
}

export async function openAccount(page: Page) {
  await settingsButton(page).click()
  await page.getByRole('button', { name: 'Account…' }).click()
  return page.getByRole('dialog', { name: 'Account' })
}

export async function signOut(page: Page) {
  await page.keyboard.press('Escape')
  await settingsButton(page).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({
    timeout: 30_000,
  })
}

/** The password half of signing in, for accounts with a second step. */
export async function enterPassword(page: Page, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

function base32(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((b) => parseInt(b, 2)))
}

/** The code an authenticator app shows, `ahead` 30-second steps from now. */
export function totp(secret: string, ahead = 0): string {
  const step = Math.floor(Date.now() / 30_000) + ahead
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const sum = createHmac('sha1', base32(secret)).update(msg).digest()
  const n = sum.readUInt32BE(sum[19]! & 0x0f) & 0x7fffffff
  return String(n % 1_000_000).padStart(6, '0')
}

// Password change and recovery with the 24-word phrase, end to end
// (PLAN.md §16): after each, the same to-dos still decrypt, the old
// password stops working, and a breached new password is refused
// (decision 31).

import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  add,
  openAccount,
  PASSWORD,
  signIn,
  signUp,
  stubBreachCheck,
} from './helpers'

const CHANGED = 'lantern moss quarry'
const RECOVERED = 'pebble harbour violet'
const BREACHED = 'breached pass phrase'

/** The SHA-1 suffix the Pwned Passwords range API would list. */
const suffix = (password: string) =>
  createHash('sha1').update(password).digest('hex').toUpperCase().slice(5)

async function newPage(page: Page) {
  const next = await (await page.context().browser()!.newContext()).newPage()
  await stubBreachCheck(next)
  return next
}

async function signInFails(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
}

test('change the password, then recover with the phrase', async ({ page }) => {
  const email = `recover-${Date.now()}@example.com`
  const title = 'Survives every password'
  const words = await signUp(page, email)
  await add(page, title)

  // Change the password in Account settings; a breached one is refused.
  await stubBreachCheck(page, [suffix(BREACHED)])
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Account…' }).click()
  const account = page.getByRole('dialog', { name: 'Account' })
  const form = account.locator('form').filter({
    has: page.getByRole('button', { name: 'Change password' }),
  })
  await form.getByLabel('Current password').fill(PASSWORD)
  await form.getByLabel('New password', { exact: true }).fill(BREACHED)
  await form.getByLabel('Confirm new password').fill(BREACHED)
  await form.getByRole('button', { name: 'Change password' }).click()
  await expect(account.getByRole('alert')).toContainText('data breach')

  await form.getByLabel('New password', { exact: true }).fill(CHANGED)
  await form.getByLabel('Confirm new password').fill(CHANGED)
  await form.getByRole('button', { name: 'Change password' }).click()
  await expect(account.getByText('Password changed.')).toBeVisible({
    timeout: 30_000,
  })

  // Another device: the old password fails, the new one decrypts the to-do.
  const other = await newPage(page)
  await signInFails(other, email, PASSWORD)
  await signIn(other, email, CHANGED)
  await expect(other.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // Forgot it: reset with the recovery phrase on a third device.
  const third = await newPage(page)
  await third.goto('/')
  await third.getByRole('button', { name: 'Forgot password?' }).click()
  await third.getByLabel('Email').fill(email)
  await third.getByLabel('Recovery phrase').fill(words.join(' '))
  await third.getByLabel('New password', { exact: true }).fill(RECOVERED)
  await third.getByLabel('Confirm new password').fill(RECOVERED)
  await third.getByRole('button', { name: 'Reset password' }).click()
  await expect(third.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // Only the recovered password signs in now.
  const fourth = await newPage(page)
  await signInFails(fourth, email, CHANGED)
  await signIn(fourth, email, RECOVERED)
  await expect(fourth.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  })
})

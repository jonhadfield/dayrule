// Accessibility (PLAN.md §16): axe finds no serious or critical WCAG 2
// A/AA violations on any screen, desktop or mobile.

import { expect, test } from '@playwright/test'
import { audit, report, type Found } from './axe'
import { add, signUp } from './helpers'

test('desktop screens have no serious accessibility problems', async ({
  page,
}) => {
  const found: Found[] = []
  await page.goto('/help')
  await audit(page, 'help', found)
  await page.goto('/help/lists')
  await audit(page, 'help: lists (with a diagram)', found)
  await page.goto('/privacy')
  await audit(page, 'privacy', found)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await audit(page, 'sign in', found)
  await page.getByRole('button', { name: 'Create an account' }).click()
  await audit(page, 'create account', found)

  await signUp(page, `a11y-${Date.now()}@example.com`)
  await page.getByRole('link', { name: 'Inbox' }).click()
  await add(page, 'Check the boiler')
  for (const list of [
    'Inbox',
    'Today',
    'Scheduled',
    'Backlog',
    'Done',
    'Trash',
  ]) {
    await page.getByRole('link', { name: list }).first().click()
    await audit(page, list, found)
  }
  await page.getByRole('link', { name: 'Inbox' }).click()
  await page.getByText('Check the boiler').dblclick()
  await audit(page, 'editor', found)
  await page.getByRole('button', { name: 'When' }).click()
  await audit(page, 'when popover', found)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.keyboard.press('ControlOrMeta+f')
  await page.keyboard.type('boil')
  await expect(
    page.getByRole('option', { name: /Check the boiler/ }),
  ).toBeVisible()
  await audit(page, 'quick find', found)
  await page.keyboard.type('zzz')
  await expect(page.getByText('Nothing found.')).toBeVisible()
  await audit(page, 'quick find: nothing found', found)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Settings' }).click()
  await audit(page, 'settings', found)
  await page.getByText('Account…').click()
  await audit(page, 'account', found)
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible()
  await audit(page, 'unlock', found)

  expect(found, report(found)).toEqual([])
})

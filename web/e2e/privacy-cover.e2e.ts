// Brand cover when the tab is hidden (PLAN.md §10.4, decision 34).
// Headless Chromium keeps visibilityState "visible", so we fire the same
// document events the browser sends when a tab is backgrounded.

import { expect, test, type Page } from '@playwright/test'
import { add, signUp } from './helpers'

async function hideTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
  })
}

async function showTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

const cover = (page: Page) =>
  page.locator('[role="presentation"]', { hasText: 'Dayrule' })

test('hides lists when the tab is in the background', async ({ page }) => {
  await signUp(page, `cover-${Date.now()}@example.com`)
  await add(page, 'Secret errand')

  await hideTab(page)
  await expect(cover(page)).toBeVisible()

  await showTab(page)
  await expect(cover(page)).toHaveCount(0)
  await expect(page.getByText('Secret errand')).toBeVisible()
})

test('does not cover the sign-in screen', async ({ page }) => {
  await page.goto('/')
  await hideTab(page)
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(cover(page)).toHaveCount(0)
})

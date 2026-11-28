// Every core action works from the keyboard alone (PLAN.md §16).

import { expect, test } from '@playwright/test'
import { signUp } from './helpers'

test('core actions by keyboard only', async ({ page }) => {
  await signUp(page, `keys-${Date.now()}@example.com`)
  const rows = page.locator('li[data-todo-id]')

  // G then I: go to the Inbox. N: new to-do; type; Escape closes it.
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.keyboard.press('n')
  await page.keyboard.type('Water the plants')
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('Water the plants')

  // ↓ selects it; T schedules it for Today, so it leaves the Inbox.
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('li[data-selected]')).toHaveCount(1)
  await page.keyboard.press('t')
  await expect(rows).toHaveCount(0)

  // G then T: Today. Select it, ⌘K completes it, ⌘Z undoes that.
  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/today$/)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(
    page.getByRole('checkbox', { name: 'Complete Water the plants' }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(
    page.getByRole('checkbox', { name: 'Complete Water the plants' }),
  ).toHaveAttribute('aria-checked', 'false')

  // Enter opens the selected to-do; Escape closes it.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeFocused()
  await page.keyboard.press('Escape')

  // ⌘F finds it; Enter goes to it and selects it.
  await page.keyboard.press('Escape') // clear the selection first
  await expect(page.locator('li[data-selected]')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+f')
  await page.keyboard.type('plants')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('li[data-selected]')).toHaveText(/Water the plants/)

  // ⌃Space Quick Entry files into Inbox without leaving Today.
  await page.keyboard.press('Control+Space')
  await expect(page.getByRole('dialog', { name: 'Quick Entry' })).toBeVisible()
  await page.keyboard.type('From Quick Entry')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Quick Entry' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(rows).toContainText('From Quick Entry')

  // ? shows the shortcuts.
  await page.keyboard.press('?')
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toBeVisible()
})

// Mobile gestures and shell (PLAN.md §6 / §16) in an emulated phone with
// real touch input.

import { devices, expect, test, type Page } from '@playwright/test'
import { add, signUp } from './helpers'

test.use({ ...devices['Pixel 7'] })

/** A one-finger horizontal swipe, sent as touch events (Chromium only). */
async function swipe(page: Page, from: { x: number; y: number }, dx: number) {
  const cdp = await page.context().newCDPSession(page)
  const at = (i: number) => [{ x: from.x + (dx * i) / 10, y: from.y }]
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: at(0),
  })
  // ~60 Hz, like a finger, then rest before lifting. Lifting while still
  // moving starts a fling, and Chrome drops the next tap's click (fling
  // tap suppression), which made the follow-up tap fail in CI.
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(i),
    })
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(120)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: at(10),
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

async function swipeRow(page: Page, title: string, dx: number) {
  const box = await page
    .getByRole('listitem')
    .filter({ hasText: title })
    .boundingBox()
  if (!box) throw new Error(`no row ${title}`)
  await swipe(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx)
}

test('swipe to schedule, swipe to select, edge swipe back', async ({
  page,
}) => {
  await signUp(page, `mobile-${Date.now()}@example.com`)
  await page.getByRole('link', { name: 'Inbox' }).tap()
  for (const t of ['Alpha', 'Bravo', 'Charlie']) await add(page, t)
  const rows = page.getByRole('listitem')

  // Swipe right: When, for that row only.
  await swipeRow(page, 'Alpha', 120)
  const when = page.getByRole('dialog', { name: 'When' })
  await expect(when).toBeVisible()
  await when.getByRole('button', { name: 'Not now' }).tap()
  await expect(rows.filter({ hasText: 'Alpha' })).toHaveCount(0)

  // Swipe left: selection mode; taps add to it; Complete acts on both.
  await swipeRow(page, 'Bravo', -120)
  const bar = page.getByRole('toolbar', { name: 'Selected to-dos' })
  await expect(bar).toContainText('1 selected')
  await expect(page.getByRole('button', { name: 'Add to-do' })).toHaveCount(0)
  await rows.filter({ hasText: 'Charlie' }).tap()
  await expect(bar).toContainText('2 selected')
  await bar.getByRole('button', { name: 'Complete' }).tap()
  await expect(bar).toHaveCount(0)
  await expect(rows).toHaveCount(0, { timeout: 10_000 }) // they move to Done

  // Swipe in from the left edge: back to the lists.
  await swipe(page, { x: 6, y: 420 }, 150)
  await expect(page).toHaveURL(/\/$/)
})

test('full-screen editor, drag Add into the list, PWA standalone', async ({
  page,
}) => {
  await signUp(page, `mobile-shell-${Date.now()}@example.com`)
  await page.getByRole('link', { name: 'Inbox' }).tap()
  await add(page, 'Anchor')

  // Tap a row: MobileEditor opens as a full-viewport dialog with Done.
  await page.getByRole('listitem').filter({ hasText: 'Anchor' }).tap()
  const editor = page.getByRole('dialog', { name: 'Edit to-do' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Done' })).toBeVisible()
  const box = await editor.boundingBox()
  const vp = page.viewportSize()
  if (!box || !vp) throw new Error('no editor box / viewport')
  expect(box.width).toBeGreaterThan(vp.width * 0.9)
  expect(box.height).toBeGreaterThan(vp.height * 0.9)
  await editor.getByLabel('Title').fill('Anchor renamed')
  await editor.getByRole('button', { name: 'Done' }).tap()
  await expect(editor).toHaveCount(0)
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Anchor renamed' }),
  ).toBeVisible()

  // Drag the Add pill onto a row: inserts a draft and opens the editor
  // (MouseSensor; Playwright's drag uses mouse even on a touch project).
  const addBtn = page.getByRole('button', { name: 'Add to-do' })
  const anchor = page
    .getByRole('listitem')
    .filter({ hasText: 'Anchor renamed' })
  await addBtn.dragTo(anchor)
  const draft = page.getByRole('dialog', { name: 'Edit to-do' })
  await expect(draft).toBeVisible({ timeout: 10_000 })
  await draft.getByLabel('Title').fill('Inserted')
  await draft.getByRole('button', { name: 'Done' }).tap()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Inserted' }),
  ).toBeVisible()

  // Installable PWA: webmanifest is standalone (served in e2e via DAYRULE_PWA_DEV).
  const res = await page.request.get('/manifest.webmanifest')
  expect(res.ok()).toBeTruthy()
  const manifest = (await res.json()) as {
    display?: string
    start_url?: string
  }
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
})

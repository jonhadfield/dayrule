// Two devices on one account edit while offline, then reconnect and
// converge (PLAN.md §16, M4 acceptance).

import { expect, test, type Page } from '@playwright/test'
import { add, signIn, signUp } from './helpers'

const titles = (page: Page) => page.getByRole('main').getByRole('listitem')

test('two devices edit offline and converge', async ({ browser }) => {
  const email = `e2e-${Date.now()}@example.com`
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()

  await signUp(a, email)
  await add(a, 'Shared to-do')
  await signIn(b, email)
  await expect(b.getByText('Shared to-do')).toBeVisible({ timeout: 30_000 })

  await a.context().setOffline(true)
  await b.context().setOffline(true)
  await add(a, 'Written on A offline')
  await add(b, 'Written on B offline')
  await b.getByRole('checkbox', { name: 'Complete Shared to-do' }).click()

  await a.context().setOffline(false)
  await b.context().setOffline(false)
  for (const page of [a, b])
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

  // Within a poll or two both show the same list: the shared to-do is done
  // (it leaves Today) and both offline to-dos are there.
  for (const page of [a, b]) {
    await expect(titles(page)).toHaveText(
      ['Written on A offline', 'Written on B offline'],
      {
        timeout: 45_000,
        useInnerText: true,
      },
    )
  }
})

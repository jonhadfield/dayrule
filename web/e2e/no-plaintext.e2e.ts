// The server database holds no plaintext user content (PLAN.md §16):
// after real to-dos have synced, every column of every table is searched
// for their text, directly and inside any base64.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { add, signIn, signUp } from './helpers'

const OUT = new URL('./.out/', import.meta.url)

/** "table.column" for each needle found anywhere in the database. */
function findInDatabase(...needles: string[]): Map<string, string[]> {
  const out = execFileSync(new URL('plaintext-check', OUT).pathname, needles, {
    env: {
      ...process.env,
      DATABASE_URL_UNPOOLED: process.env.E2E_DATABASE_URL,
    },
  }).toString()
  const found = new Map<string, string[]>()
  for (const line of out.split('\n').filter(Boolean)) {
    const [column, needle] = line.split('\t') as [string, string]
    found.set(needle, [...(found.get(needle) ?? []), column])
  }
  return found
}

test('the database holds no plaintext to-dos', async ({ browser }) => {
  const stamp = Date.now()
  const email = `plain-${stamp}@example.com`
  const title = `Marigold title ${stamp}`
  const notes = `Quince notes ${stamp}`

  const a = await (await browser.newContext()).newPage()
  await signUp(a, email)
  await add(a, title)
  // A click selects the to-do; Enter opens it.
  await a.getByText(title, { exact: true }).click()
  await a.keyboard.press('Enter')
  await a.getByRole('textbox', { name: 'Notes' }).fill(notes)
  await a.keyboard.press('Escape')

  // A second device sees both, so they have reached the server.
  const b = await (await browser.newContext()).newPage()
  await signIn(b, email)
  await b.getByText(title, { exact: true }).click({ timeout: 30_000 })
  await b.keyboard.press('Enter')
  await expect(b.getByRole('textbox', { name: 'Notes' })).toHaveValue(notes, {
    timeout: 30_000,
  })

  const found = findInDatabase(email, title, notes)
  // The email address is stored in plaintext by design (PLAN.md §15), so
  // finding it proves the search reaches this account's rows.
  expect(found.get(email)).toContain('users.email')
  expect(found.get(title)).toBeUndefined()
  expect(found.get(notes)).toBeUndefined()
})

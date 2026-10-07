// The production build refuses a tampered crypto worker (PLAN.md §10.7).
// Signs in twice against a served dist/ (vite preview) with the API mocked:
// with the real worker it must start; with a changed byte it must not, and
// the page must say why. Run: node build/check-worker-sri.mjs [base URL].
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:4173'
const refused = /couldn’t verify its encryption code/

async function signIn(tamper) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
  })
  try {
    const page = await browser.newPage()
    let workers = 0
    page.on('worker', () => workers++)
    await page.route('**/api/v1/auth/prelogin', (r) =>
      r.fulfill({
        json: {
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          kdf: { v: 1, ops: 1, mem: 8 * 1024 * 1024 },
        },
      }),
    )
    await page.route('**/api/v1/auth/login', (r) =>
      r.fulfill({ status: 401, json: { error: 'Wrong email or password.' } }),
    )
    if (tamper) {
      await page.route('**/assets/worker-*.js', async (r) => {
        const res = await r.fetch()
        r.fulfill({ response: res, body: `${await res.text()}\n//` })
      })
    }
    await page.goto(base)
    await page.getByLabel('Email').fill('check@example.com')
    await page.getByLabel('Password').fill('correct horse battery staple')
    await page.getByRole('button', { name: 'Sign in' }).click()
    const alert = tamper ? refused : /Wrong email or password/
    // A missing message is reported below, not thrown.
    await page
      .getByText(alert)
      .waitFor({ timeout: 30_000 })
      .catch(() => {})
    return { workers, refusedShown: await page.getByText(refused).count() }
  } finally {
    await browser.close()
  }
}

const real = await signIn(false)
const tampered = await signIn(true)
const ok =
  real.workers === 1 &&
  real.refusedShown === 0 &&
  tampered.workers === 0 &&
  tampered.refusedShown === 1
console.log(
  `real worker: ${real.workers} started; tampered worker: ${tampered.workers} started, refusal shown: ${tampered.refusedShown === 1}`,
)
if (!ok) {
  console.error('Crypto worker integrity check failed')
  process.exit(1)
}
console.log('Worker SRI ok')

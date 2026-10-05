// Performance target (PLAN.md decision 24): time to interactive on an
// emulated mid-range phone (Lighthouse's mobile profile: slow 4G, 4× CPU
// slowdown), cold start and warm start from the service worker cache.
// Medians of three runs. Bundle size is reported as a warning only.
//
// Usage: node build/perf.mjs <url>   (with the built app served at <url>)

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import * as chromeLauncher from 'chrome-launcher'
import lighthouse from 'lighthouse'

const url = process.argv[2] ?? 'http://localhost:4173/'
const RUNS = 3
const LIMITS = {
  cold: { interactive: 3500, tbt: 200, score: 0.9 },
  warm: { interactive: 1500, tbt: 200, score: 0.9 },
}
const BUNDLE_WARN_KB = 250

async function measure(warm) {
  const profile = mkdtempSync(join(tmpdir(), 'dayrule-lh-'))
  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH,
    userDataDir: profile,
    chromeFlags: ['--headless=new', '--no-sandbox'],
  })
  try {
    const run = () =>
      lighthouse(url, {
        port: chrome.port,
        onlyCategories: ['performance'],
        formFactor: 'mobile',
        // Warm: keep the service worker and its cache from the first load.
        disableStorageReset: warm,
        logLevel: 'error',
      })
    if (warm) await run() // installs the service worker
    const r = (await run()).lhr
    return {
      interactive: r.audits.interactive.numericValue,
      tbt: r.audits['total-blocking-time'].numericValue,
      lcp: r.audits['largest-contentful-paint'].numericValue,
      score: r.categories.performance.score,
    }
  } finally {
    await chrome.kill()
    rmSync(profile, { recursive: true, force: true })
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

let failed = false
for (const kind of ['cold', 'warm']) {
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await measure(kind === 'warm'))
  const m = {
    interactive: median(runs.map((r) => r.interactive)),
    tbt: median(runs.map((r) => r.tbt)),
    lcp: median(runs.map((r) => r.lcp)),
    score: median(runs.map((r) => r.score)),
  }
  const limit = LIMITS[kind]
  const ok =
    m.interactive <= limit.interactive &&
    m.tbt <= limit.tbt &&
    m.score >= limit.score
  failed ||= !ok
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${kind}: interactive ${(m.interactive / 1000).toFixed(2)} s (limit ${limit.interactive / 1000} s), ` +
      `blocking ${Math.round(m.tbt)} ms (limit ${limit.tbt}), LCP ${(m.lcp / 1000).toFixed(2)} s, score ${Math.round(m.score * 100)} (min ${limit.score * 100})`,
  )
}

// Initial JS, gzipped: a warning, not a limit (decision 24).
const html = readFileSync('dist/index.html', 'utf8')
const entry = html.match(/<script[^>]+src="\/(assets\/[^"]+\.js)"/)?.[1]
const kb = Math.round(gzipSync(readFileSync(`dist/${entry}`)).length / 1024)
const chunks = readdirSync('dist/assets').filter((f) =>
  f.endsWith('.js'),
).length
console.log(`initial JS: ${kb} KB gzipped (${chunks} JS files in total)`)
if (kb > BUNDLE_WARN_KB) {
  console.log(
    `::warning title=Bundle size::Initial JS is ${kb} KB gzipped, over the ${BUNDLE_WARN_KB} KB guideline`,
  )
}
process.exit(failed ? 1 : 0)

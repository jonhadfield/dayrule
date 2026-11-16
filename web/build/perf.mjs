// Performance target (PLAN.md decision 24): time to interactive on an
// emulated mid-range phone (Lighthouse's mobile profile: slow 4G, 4× CPU
// slowdown), cold start and warm start from the service worker cache.
// Medians of three runs. Bundle size is reported as a warning only.
//
// CI runners occasionally spike TBT / fail chrome-launcher; each kind gets
// one automatic retry if the first median misses the limits, and Chrome
// launch itself retries a few times.
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
const CHROME_LAUNCH_ATTEMPTS = 3
const LIMITS = {
  cold: { interactive: 3500, tbt: 200, score: 0.9 },
  warm: { interactive: 1500, tbt: 200, score: 0.9 },
}
const BUNDLE_WARN_KB = 250

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function launchChrome(profile) {
  let last
  for (let attempt = 1; attempt <= CHROME_LAUNCH_ATTEMPTS; attempt++) {
    try {
      return await chromeLauncher.launch({
        chromePath: process.env.CHROME_PATH,
        userDataDir: profile,
        chromeFlags: ['--headless=new', '--no-sandbox'],
      })
    } catch (err) {
      last = err
      if (attempt < CHROME_LAUNCH_ATTEMPTS) await sleep(500 * attempt)
    }
  }
  throw last
}

async function measure(warm) {
  const profile = mkdtempSync(join(tmpdir(), 'dayrule-lh-'))
  let chrome
  try {
    chrome = await launchChrome(profile)
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
    await chrome?.kill()
    rmSync(profile, { recursive: true, force: true })
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function summarise(runs) {
  return {
    interactive: median(runs.map((r) => r.interactive)),
    tbt: median(runs.map((r) => r.tbt)),
    lcp: median(runs.map((r) => r.lcp)),
    score: median(runs.map((r) => r.score)),
  }
}

function passes(m, limit) {
  return (
    m.interactive <= limit.interactive &&
    m.tbt <= limit.tbt &&
    m.score >= limit.score
  )
}

function formatLine(ok, kind, m, limit) {
  return (
    `${ok ? 'ok  ' : 'FAIL'} ${kind}: interactive ${(m.interactive / 1000).toFixed(2)} s (limit ${limit.interactive / 1000} s), ` +
    `blocking ${Math.round(m.tbt)} ms (limit ${limit.tbt}), LCP ${(m.lcp / 1000).toFixed(2)} s, score ${Math.round(m.score * 100)} (min ${limit.score * 100})`
  )
}

async function measureKind(warm) {
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await measure(warm))
  return summarise(runs)
}

let failed = false
for (const kind of ['cold', 'warm']) {
  const limit = LIMITS[kind]
  const warm = kind === 'warm'
  let m = await measureKind(warm)
  let ok = passes(m, limit)
  if (!ok) {
    console.log(
      `retry ${kind}: first median missed limits; measuring once more`,
    )
    m = await measureKind(warm)
    ok = passes(m, limit)
  }
  failed ||= !ok
  console.log(formatLine(ok, kind, m, limit))
}

// Initial JS, gzipped: a warning, not a limit (decision 24). Sum every
// script / modulepreload on the app page (help/legal are separate entries).
const html = readFileSync('dist/index.html', 'utf8')
const initialJs = [
  ...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g),
].map((m) => m[1])
const kb = Math.round(
  initialJs.reduce(
    (n, file) => n + gzipSync(readFileSync(`dist/${file}`)).length,
    0,
  ) / 1024,
)
const chunks = readdirSync('dist/assets').filter((f) =>
  f.endsWith('.js'),
).length
console.log(
  `initial JS: ${kb} KB gzipped (${initialJs.length} on index.html, ${chunks} JS files in total)`,
)
if (kb > BUNDLE_WARN_KB) {
  console.log(
    `::warning title=Bundle size::Initial JS is ${kb} KB gzipped, over the ${BUNDLE_WARN_KB} KB guideline`,
  )
}
process.exit(failed ? 1 : 0)

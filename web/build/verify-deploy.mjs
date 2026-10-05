// Check that a deployment serves exactly what this source builds
// (PLAN.md §10.7). Run from web/ on the commit the site reports:
//
//   git checkout <sha from https://dayrule.app/api/health>
//   pnpm install --frozen-lockfile
//   pnpm verify-deploy https://dayrule.app
//
// It builds with production's settings, fetches every built file from the
// site and compares them byte for byte.

import { execFileSync } from 'node:child_process'
import { buildHash, sha256 } from './build-hash.mjs'

const origin = (process.argv[2] ?? 'https://dayrule.app').replace(/\/$/, '')
const health = await (await fetch(`${origin}/api/health`)).json()
const commit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()
if (!commit.startsWith(health.version)) {
  console.error(
    `${origin} runs ${health.version}; this checkout is ${commit.slice(0, 7)}. Check out ${health.version} first.`,
  )
  process.exit(2)
}

execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
  stdio: 'inherit',
  // The settings production builds with (vite.config.ts reads both).
  env: {
    ...process.env,
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_SHA: commit,
  },
})
const { files, hash } = buildHash()

let different = 0
for (const [path, local] of files) {
  const res = await fetch(`${origin}/${path}`, { cache: 'no-store' })
  const remote = res.ok
    ? sha256(Buffer.from(await res.arrayBuffer()))
    : `HTTP ${res.status}`
  if (remote !== local) {
    different++
    console.log(`different: ${path}`)
  }
}
console.log(
  `${files.length - different} of ${files.length} files match; build hash ${hash}`,
)
process.exit(different ? 1 : 0)

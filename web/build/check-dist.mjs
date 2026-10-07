// After a build (PLAN.md §10.7):
// - every script and stylesheet in dist/index.html carries an integrity hash
//   that matches the file on disk;
// - every other script in dist/assets (the crypto worker) has its hash
//   written into a script that is itself covered, so nothing runs unchecked.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

const sha384 = (file) =>
  createHash('sha384')
    .update(readFileSync(`dist/${file}`))
    .digest('base64')

const html = readFileSync('dist/index.html', 'utf8')
const tags = [...html.matchAll(/<(script|link)\b[^>]*>/g)].map((m) => m[0])
const assets = tags.filter((t) => /(src|href)="\/assets\//.test(t))
const covered = new Set()
let bad = 0
for (const tag of assets) {
  const file = tag.match(/(?:src|href)="\/(assets\/[^"]+)"/)[1]
  const integrity = tag.match(/integrity="sha384-([^"]+)"/)?.[1]
  if (integrity !== sha384(file)) {
    console.error(`SRI mismatch or missing: ${file}`)
    bad++
  } else covered.add(file)
}
if (assets.length === 0) {
  console.error('No asset tags found in dist/index.html')
  bad++
}

const coveredScripts = [...covered]
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(`dist/${f}`, 'utf8'))
let embedded = 0
for (const name of readdirSync('dist/assets')) {
  const file = `assets/${name}`
  if (!name.endsWith('.js') || covered.has(file)) continue
  if (coveredScripts.some((code) => code.includes(sha384(file)))) embedded++
  else {
    console.error(`Script not covered by SRI: ${file}`)
    bad++
  }
}
if (
  coveredScripts.some((code) => code.includes('__DAYRULE_WORKER_INTEGRITY__'))
) {
  console.error('The crypto worker hash was not written into the bundle')
  bad++
}

if (bad) process.exit(1)
console.log(`SRI ok: ${assets.length} tags, ${embedded} embedded hash`)

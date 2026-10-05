// After a build: every script and stylesheet in dist/index.html carries an
// integrity hash that matches the file on disk (PLAN.md §10.7).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const html = readFileSync('dist/index.html', 'utf8')
const tags = [...html.matchAll(/<(script|link)\b[^>]*>/g)].map((m) => m[0])
const assets = tags.filter((t) => /(src|href)="\/assets\//.test(t))
let bad = 0
for (const tag of assets) {
  const file = tag.match(/(?:src|href)="\/(assets\/[^"]+)"/)[1]
  const integrity = tag.match(/integrity="sha384-([^"]+)"/)?.[1]
  const actual = createHash('sha384')
    .update(readFileSync(`dist/${file}`))
    .digest('base64')
  if (integrity !== actual) {
    console.error(`SRI mismatch or missing: ${file}`)
    bad++
  }
}
if (assets.length === 0) {
  console.error('No asset tags found in dist/index.html')
  bad++
}
if (bad) process.exit(1)
console.log(`SRI ok: ${assets.length} tags`)

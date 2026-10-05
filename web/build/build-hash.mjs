// The build hash (PLAN.md §10.7): one SHA-256 over the SHA-256 of every
// file in dist/, in path order. A build of the same commit with the same
// settings gives the same hash, so it can be checked against what
// dayrule.app serves (build/verify-deploy.mjs).

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export function listFiles(dir, root = dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory()
        ? listFiles(path, root)
        : [relative(root, path)]
    })
    .sort()
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** `{ files: [[path, sha256]...], hash }` for a dist directory. */
export function buildHash(dist = 'dist') {
  const files = listFiles(dist).map((f) => [
    f,
    sha256(readFileSync(join(dist, f))),
  ])
  return { files, hash: sha256(files.map(([f, h]) => `${h}  ${f}\n`).join('')) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, hash } = buildHash()
  if (process.argv.includes('--files'))
    for (const [f, h] of files) console.log(`${h}  ${f}`)
  console.log(hash)
}

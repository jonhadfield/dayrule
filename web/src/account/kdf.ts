// The client's floor for key derivation parameters that come from the
// server (PLAN.md §10.2). Kept out of crypto/primitives.ts so the main
// thread doesn't pull in libsodium.

import type { KdfParams } from '../crypto/primitives'

// The same range the server accepts from clients (`validKdf` in
// server/internal/httpapi/accounts.go): never below the defaults.
export const MIN_KDF_OPS = 3
export const MAX_KDF_OPS = 10
export const MIN_KDF_MEM = 64 * 1024 * 1024
export const MAX_KDF_MEM = 1024 * 1024 * 1024

export const UNSAFE_KDF =
  'The server asked for weaker password protection than Dayrule allows, so your password wasn’t used. Try again later.'

/**
 * Throws unless `kdf` is in the accepted range. A hostile server could
 * otherwise send cheap Argon2id parameters, then brute-force the password
 * from the AuthKey it receives at sign-in.
 */
export function checkServerKdf(kdf: unknown): asserts kdf is KdfParams {
  const k = kdf as Partial<KdfParams> | null
  const ok =
    typeof k === 'object' &&
    k !== null &&
    k.v === 1 &&
    Number.isInteger(k.ops) &&
    Number.isInteger(k.mem) &&
    k.ops! >= MIN_KDF_OPS &&
    k.ops! <= MAX_KDF_OPS &&
    k.mem! >= MIN_KDF_MEM &&
    k.mem! <= MAX_KDF_MEM
  if (!ok) throw new Error(UNSAFE_KDF)
}

// Fractional ordering (PLAN.md §4.3). Moving an item rewrites only that
// item's key, so concurrent reorders on two devices rarely conflict.

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { OrderKey } from './types'

/** Byte-wise comparison. Keys must not be compared with localeCompare. */
export function compareKeys(a: OrderKey, b: OrderKey): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function keyBetween(
  before: OrderKey | null | undefined,
  after: OrderKey | null | undefined,
): OrderKey {
  return generateKeyBetween(before ?? null, after ?? null)
}

export function keysBetween(
  before: OrderKey | null | undefined,
  after: OrderKey | null | undefined,
  n: number,
): OrderKey[] {
  return generateNKeysBetween(before ?? null, after ?? null, n)
}

/** Key for appending after the last of `keys` (in any order). */
export function keyAfterLast(keys: readonly OrderKey[]): OrderKey {
  const last = keys.reduce<OrderKey | null>(
    (max, k) => (max === null || k > max ? k : max),
    null,
  )
  return keyBetween(last, null)
}

/**
 * Key that places an item at `index` within `sortedKeys` (the destination
 * list, already sorted and without the moving item).
 */
export function keyAtIndex(
  sortedKeys: readonly OrderKey[],
  index: number,
): OrderKey {
  const clamped = Math.max(0, Math.min(index, sortedKeys.length))
  return keyBetween(sortedKeys[clamped - 1], sortedKeys[clamped])
}

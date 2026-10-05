import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Hlc } from './hlc'
import {
  latestStamp,
  mergeEntity,
  resolveTombstone,
  type Clocked,
} from './merge'

type E = Clocked & {
  id: string
  title?: string
  notes?: string
  done?: boolean
}

describe('Hlc', () => {
  it('produces strictly increasing, comparable stamps', () => {
    let t = 1000
    const h = new Hlc('a', () => t)
    const a = h.tick()
    const b = h.tick() // same millisecond: counter
    t = 999 // clock went backwards
    const c = h.tick()
    t = 5000
    const d = h.tick()
    expect([a, b, c, d]).toEqual([...[a, b, c, d]].sort())
    expect(new Set([a, b, c, d]).size).toBe(4)
  })

  it('moves past stamps observed from other devices', () => {
    const h = new Hlc('a', () => 10)
    const remote = new Hlc('b', () => 99_999).tick()
    h.observe(remote)
    expect(h.tick() > remote).toBe(true)
  })
})

describe('mergeEntity', () => {
  it('takes each field from its latest writer', () => {
    const local: E = {
      id: '1',
      title: 'L',
      notes: 'L',
      clock: { id: '1', title: '3', notes: '1' },
    }
    const remote: E = {
      id: '1',
      title: 'R',
      notes: 'R',
      clock: { id: '1', title: '2', notes: '4' },
    }
    expect(mergeEntity(local, remote)).toEqual({
      id: '1',
      title: 'L',
      notes: 'R',
      clock: { id: '1', title: '3', notes: '4' },
    })
  })

  it('removes a field cleared by the latest writer', () => {
    const local: E = { id: '1', title: 'x', clock: { id: '1', title: '1' } }
    const remote: E = { id: '1', clock: { id: '1', title: '2' } }
    expect(mergeEntity(local, remote)).toEqual({
      id: '1',
      clock: { id: '1', title: '2' },
    })
  })

  it('a tombstone wins unless the entity was edited after it', () => {
    const e: E = { id: '1', title: 'x', clock: { id: '1', title: '5' } }
    expect(resolveTombstone(e, '6').kind).toBe('delete')
    expect(resolveTombstone(e, '4')).toEqual({ kind: 'keep', value: e })
    expect(latestStamp(e)).toBe('5')
  })

  // Property: replicas that see the same set of writes, in any order and
  // with any grouping, end up identical (commutative, associative,
  // idempotent).
  it('converges regardless of order', () => {
    const write = fc.record({
      field: fc.constantFrom('title', 'notes', 'done'),
      value: fc.oneof(
        fc.string({ maxLength: 3 }),
        fc.boolean(),
        fc.constant(undefined),
      ),
      stamp: fc.integer({ min: 1, max: 1_000_000 }),
      device: fc.constantFrom('a', 'b', 'c'),
    })
    fc.assert(
      fc.property(
        fc.array(write, { minLength: 1, maxLength: 30 }),
        fc.integer(),
        (writes, seed) => {
          // Each write becomes a single-field version of the entity.
          const versions: E[] = writes.map((w, i) => ({
            id: 'x',
            ...(w.value === undefined ? {} : { [w.field]: w.value }),
            clock: {
              [w.field]: `${String(w.stamp).padStart(7, '0')}-${String(i).padStart(3, '0')}-${w.device}`,
            },
          }))
          const fold = (vs: E[]) =>
            vs.reduce<E | undefined>((acc, v) => mergeEntity(acc, v), undefined)
          const shuffled = [...versions].sort(
            (a, b) =>
              ((JSON.stringify(a).length * seed) % 7) -
              ((JSON.stringify(b).length * seed) % 7),
          )
          const reversed = [...versions].reverse()
          const twice = [...versions, ...versions]
          const a = fold(versions)
          expect(fold(shuffled)).toEqual(a)
          expect(fold(reversed)).toEqual(a)
          expect(fold(twice)).toEqual(a)
          // Grouping: merge halves separately, then merge the results.
          const mid = Math.floor(versions.length / 2)
          const left = fold(versions.slice(0, mid))
          const right = fold(versions.slice(mid))
          const grouped =
            left && right ? mergeEntity(left, right) : (left ?? right)
          expect(grouped).toEqual(a)
        },
      ),
      { numRuns: 500 },
    )
  })
})

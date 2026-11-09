// Known-answer domain vectors for the native companion (dayrule-apple PLAN §16).
// Regenerate: WRITE_DOMAIN_VECTORS=1 pnpm --filter web test src/domain/domain-vectors.test.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWhen } from './dates'
import { Hlc } from './hlc'
import {
  latestStamp,
  mergeEntity,
  resolveTombstone,
  type Clocked,
} from './merge'
import { compareKeys, keyBetween, keysBetween } from './order'
import {
  dueAfterCompletion,
  occurrenceAfter,
  occurrenceOnOrAfter,
} from './repeat'
import type { Repeat } from './types'
import { instanceId } from '../store/repeats'

type MergeE = Clocked & {
  id: string
  title?: string
  notes?: string
  done?: boolean
}

const FILE = path.resolve(
  import.meta.dirname,
  '../../../docs/shared/domain-vectors.json',
)

type WhenCase = {
  input: string
  today: string // YYYY-MM-DD local calendar day
  result: unknown
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function build() {
  const today = '2026-10-04' // Sunday
  const wed = '2026-10-07'
  const parseWhenCases: WhenCase[] = [
    ['today', today, { kind: 'today' }],
    ['Today ', today, { kind: 'today' }],
    ['tonight', today, { kind: 'today' }],
    ['later', today, { kind: 'later' }],
    ['tom', today, { kind: 'date', date: '2026-10-05' }],
    ['tomorrow', today, { kind: 'date', date: '2026-10-05' }],
    ['in 3 days', today, { kind: 'date', date: '2026-10-07' }],
    ['in 2 weeks', today, { kind: 'date', date: '2026-10-18' }],
    ['in 1 month', today, { kind: 'date', date: '2026-11-04' }],
    ['next week', today, { kind: 'date', date: '2026-10-05' }],
    ['next month', today, { kind: 'date', date: '2026-11-01' }],
    ['mon', today, { kind: 'date', date: '2026-10-05' }],
    ['fri', today, { kind: 'date', date: '2026-10-09' }],
    ['sun', today, { kind: 'date', date: '2026-10-11' }],
    ['next fri', today, { kind: 'date', date: '2026-10-09' }],
    ['2026-10-20', today, { kind: 'date', date: '2026-10-20' }],
    ['10/4', today, { kind: 'date', date: '2026-10-04' }],
    ['3/1', today, { kind: 'date', date: '2027-03-01' }],
    ['20 oct', today, { kind: 'date', date: '2026-10-20' }],
    ['oct 20', today, { kind: 'date', date: '2026-10-20' }],
    ['next mon', wed, { kind: 'date', date: '2026-10-12' }],
    ['next fri', wed, { kind: 'date', date: '2026-10-16' }],
    ['fri', wed, { kind: 'date', date: '2026-10-09' }],
    ['not a when', today, null],
  ].map(([input, day, result]) => ({
    input: input as string,
    today: day as string,
    result,
  }))

  // Recompute from code so the file cannot drift from behaviour.
  for (const c of parseWhenCases) {
    c.result = parseWhen(c.input, localDate(c.today))
  }

  const a = keyBetween(null, null)
  const b = keyBetween(a, null)
  const mid = keyBetween(a, b)
  const batch = keysBetween(a, b, 3)

  let t = 1_000_000_000_000
  const hlc = new Hlc('dev1', () => t)
  const tick1 = hlc.tick()
  const tick2 = hlc.tick() // same wall, counter++
  t = 1_000_000_000_100
  const tick3 = hlc.tick()
  hlc.observe('lfls-0002-other')
  const tick4 = hlc.tick()

  const mergeLocal: MergeE = {
    id: '1',
    title: 'L',
    notes: 'L',
    clock: { id: '1', title: '3', notes: '1' },
  }
  const mergeRemote: MergeE = {
    id: '1',
    title: 'R',
    notes: 'R',
    clock: { id: '1', title: '2', notes: '4' },
  }
  const clearLocal: MergeE = {
    id: '1',
    title: 'x',
    clock: { id: '1', title: '1' },
  }
  const clearRemote: MergeE = { id: '1', clock: { id: '1', title: '2' } }
  const tombEntity: MergeE = {
    id: '1',
    title: 'x',
    clock: { id: '1', title: '5' },
  }

  const rule = (r: Partial<Repeat>): Repeat => ({
    freq: 'day',
    every: 1,
    mode: 'fixed',
    anchor: '2026-10-04',
    ...r,
  })

  /** Successive occurrences from the anchor (same helper as repeat.test.ts). */
  function first(r: Repeat, n: number): string[] {
    const out = [occurrenceOnOrAfter(r, r.anchor)]
    while (out.length < n) out.push(occurrenceAfter(r, out[out.length - 1]!))
    return out
  }

  const templateId = '6b0f3c55-0000-4000-8000-000000000001'
  const instanceDate = '2026-10-04'

  return {
    version: 2,
    parseWhen: parseWhenCases,
    order: {
      keyBetween: [
        { before: null, after: null, result: a },
        { before: a, after: null, result: b },
        { before: a, after: b, result: mid },
      ],
      keysBetween: [{ before: a, after: b, n: 3, result: batch }],
      compare: [
        { a, b, result: compareKeys(a, b) },
        { a: mid, b, result: compareKeys(mid, b) },
      ],
    },
    hlc: {
      device: 'dev1',
      steps: [
        { op: 'tick', now: 1_000_000_000_000, result: tick1 },
        { op: 'tick', now: 1_000_000_000_000, result: tick2 },
        { op: 'tick', now: 1_000_000_000_100, result: tick3 },
        { op: 'observe', stamp: 'lfls-0002-other' },
        { op: 'tick', now: 1_000_000_000_100, result: tick4 },
      ],
    },
    merge: {
      triples: [
        {
          local: mergeLocal,
          remote: mergeRemote,
          result: mergeEntity(mergeLocal, mergeRemote),
        },
        {
          local: clearLocal,
          remote: clearRemote,
          result: mergeEntity(clearLocal, clearRemote),
        },
        {
          local: null,
          remote: mergeRemote,
          result: mergeEntity(undefined, mergeRemote),
        },
      ],
      tombstones: [
        {
          entity: tombEntity,
          tombstone: '6',
          result: resolveTombstone(tombEntity, '6'),
        },
        {
          entity: tombEntity,
          tombstone: '4',
          result: resolveTombstone(tombEntity, '4'),
        },
      ],
      latestStamp: [{ entity: tombEntity, result: latestStamp(tombEntity) }],
    },
    // PLAN §16.1: repeat sequences + instanceId (31st clamp, 29 Feb, DST,
    // weekly sets, after-completion). Expand further when list-selector /
    // merge-trace fixtures land.
    repeats: {
      instanceId: [
        {
          templateId,
          date: instanceDate,
          result: instanceId(templateId, instanceDate),
        },
      ],
      sequences: [
        {
          name: 'every-3-days',
          rule: rule({ every: 3 }),
          count: 3,
          result: first(rule({ every: 3 }), 3),
        },
        {
          name: 'weekly-mon-thu',
          rule: rule({ freq: 'week', weekdays: [0, 3] }),
          count: 4,
          result: first(rule({ freq: 'week', weekdays: [0, 3] }), 4),
        },
        {
          name: 'fortnightly-monday',
          rule: rule({
            freq: 'week',
            every: 2,
            weekdays: [0],
            anchor: '2026-10-05',
          }),
          count: 3,
          result: first(
            rule({
              freq: 'week',
              every: 2,
              weekdays: [0],
              anchor: '2026-10-05',
            }),
            3,
          ),
        },
        {
          name: 'monthly-31st-clamp',
          rule: rule({ freq: 'month', anchor: '2026-01-31' }),
          count: 4,
          result: first(rule({ freq: 'month', anchor: '2026-01-31' }), 4),
        },
        {
          name: 'yearly-29-feb',
          rule: rule({ freq: 'year', anchor: '2028-02-29' }),
          count: 3,
          result: first(rule({ freq: 'year', anchor: '2028-02-29' }), 3),
        },
        {
          name: 'daily-across-uk-dst',
          rule: rule({ anchor: '2026-10-24' }),
          count: 3,
          result: first(rule({ anchor: '2026-10-24' }), 3),
        },
      ],
      onOrAfter: [
        {
          rule: rule({ every: 3 }),
          from: '2026-10-05',
          result: occurrenceOnOrAfter(rule({ every: 3 }), '2026-10-05'),
        },
      ],
      dueAfterCompletion: [
        {
          rule: rule({ every: 3, mode: 'afterCompletion' }),
          done: '2026-10-04',
          result: dueAfterCompletion(
            rule({ every: 3, mode: 'afterCompletion' }),
            '2026-10-04',
          ),
        },
        {
          rule: rule({ freq: 'month', mode: 'afterCompletion' }),
          done: '2026-01-31',
          result: dueAfterCompletion(
            rule({ freq: 'month', mode: 'afterCompletion' }),
            '2026-01-31',
          ),
        },
      ],
    },
  }
}

describe('domain vectors', () => {
  it('match docs/shared/domain-vectors.json', () => {
    const vectors = build()
    if (process.env.WRITE_DOMAIN_VECTORS === '1') {
      mkdirSync(path.dirname(FILE), { recursive: true })
      writeFileSync(FILE, `${JSON.stringify(vectors, null, 2)}\n`)
    }
    const committed = JSON.parse(readFileSync(FILE, 'utf8')) as unknown
    expect(committed).toEqual(vectors)
  })
})

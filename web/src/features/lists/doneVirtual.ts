// Pure helpers for windowing the Done list (PLAN.md §4.1).

import type { DoneDay, Item } from '../../domain/lists'
import type { Project, Todo } from '../../domain/types'

export type DoneFlatRow =
  | { kind: 'heading'; date: string; key: string }
  | { kind: 'todo'; item: Todo; key: string }
  | { kind: 'project'; item: Project; key: string }

/** Flatten day groups into one sequence of headings and rows. */
export function flattenDoneDays(days: DoneDay[]): DoneFlatRow[] {
  const rows: DoneFlatRow[] = []
  for (const day of days) {
    rows.push({ kind: 'heading', date: day.date, key: `h:${day.date}` })
    for (const item of day.items) {
      if (item.type === 'todo')
        rows.push({ kind: 'todo', item, key: `t:${item.id}` })
      else if (item.type === 'project')
        rows.push({ kind: 'project', item, key: `p:${item.id}` })
    }
  }
  return rows
}

export function todoIdsFromDoneRows(rows: DoneFlatRow[]): string[] {
  return rows.filter((r) => r.kind === 'todo').map((r) => r.item.id)
}

/** Estimated pixel height of a flat row (headings include top margin). */
export function estimateDoneRowHeight(
  row: DoneFlatRow,
  itemHeight: number,
): number {
  return row.kind === 'heading' ? 44 : itemHeight
}

export function doneRowOffsets(
  rows: DoneFlatRow[],
  itemHeight: number,
): { offsets: number[]; total: number } {
  const offsets: number[] = []
  let y = 0
  for (const row of rows) {
    offsets.push(y)
    y += estimateDoneRowHeight(row, itemHeight)
  }
  return { offsets, total: y }
}

/** Inclusive start / exclusive end indices visible in the viewport. */
export function windowForScroll(
  scrollTop: number,
  viewport: number,
  offsets: number[],
  overscan = 6,
): { start: number; end: number } {
  if (offsets.length === 0) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  const bottom = top + viewport
  let start = 0
  while (start < offsets.length - 1 && offsets[start + 1]! <= top) start++
  let end = start
  while (end < offsets.length && offsets[end]! < bottom) end++
  start = Math.max(0, start - overscan)
  end = Math.min(offsets.length, end + overscan)
  return { start, end }
}

export function indexOfItemId(rows: DoneFlatRow[], id: string): number {
  return rows.findIndex(
    (r) =>
      (r.kind === 'todo' || r.kind === 'project') && (r.item as Item).id === id,
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useUI } from '../../app/ui-state'
import { formatDisplayDate } from '../../domain/dates'
import type { DoneDay, ListContext } from '../../domain/lists'
import { ProjectRow } from '../todo/ProjectRow'
import { TodoRow } from '../todo/TodoRow'
import {
  doneRowOffsets,
  flattenDoneDays,
  indexOfItemId,
  todoIdsFromDoneRows,
  windowForScroll,
  type DoneFlatRow,
} from './doneVirtual'
import { SectionHeading } from './ListShell'

function scrollParentOf(el: HTMLElement | null): HTMLElement | Window {
  let n = el?.parentElement ?? null
  while (n) {
    const { overflowY } = getComputedStyle(n)
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      overflowY === 'overlay'
    )
      return n
    n = n.parentElement
  }
  return window
}

function scrollMetrics(scroller: HTMLElement | Window): {
  scrollTop: number
  viewport: number
} {
  if (scroller === window) {
    return { scrollTop: window.scrollY, viewport: window.innerHeight }
  }
  const el = scroller as HTMLElement
  return { scrollTop: el.scrollTop, viewport: el.clientHeight }
}

function setScrollTop(scroller: HTMLElement | Window, top: number): void {
  if (scroller === window) window.scrollTo(0, top)
  else (scroller as HTMLElement).scrollTop = top
}

/** Offset of `root` from the top of the scroller's content. */
function rootOffsetInScroller(
  root: HTMLElement,
  scroller: HTMLElement | Window,
  scrollTop: number,
): number {
  const rootRect = root.getBoundingClientRect()
  if (scroller === window) return rootRect.top + scrollTop
  const sRect = (scroller as HTMLElement).getBoundingClientRect()
  return rootRect.top - sRect.top + scrollTop
}

function itemRowHeight(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--row-height')
    .trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 46
}

/**
 * Windowed Done list: only nearby day headings and rows mount, so a long
 * logbook stays cheap. Keyboard order comes from `listTodoIds` on UI state
 * (not the DOM), so off-screen rows stay selectable.
 */
export function VirtualDoneList({
  days,
  ctx,
}: {
  days: DoneDay[]
  ctx: ListContext
}) {
  const rows = useMemo(() => flattenDoneDays(days), [days])
  const todoIds = useMemo(() => todoIdsFromDoneRows(rows), [rows])
  const todoIdsKey = todoIds.join('\0')
  const rootRef = useRef<HTMLDivElement>(null)
  const itemHeight = itemRowHeight()
  const [win, setWin] = useState({ start: 0, end: 40 })
  const selectedId = useUI((s) => s.selectedIds[s.selectedIds.length - 1])
  const editingId = useUI((s) => s.editingId)

  useEffect(() => {
    useUI.getState().setListTodoIds(todoIds)
    return () => useUI.getState().setListTodoIds(null)
  }, [todoIds, todoIdsKey])

  const { offsets, total } = useMemo(
    () => doneRowOffsets(rows, itemHeight),
    [rows, itemHeight],
  )

  // Expanded editor height isn't estimated; fall back to a full mount.
  const virtualize = !(editingId && todoIds.includes(editingId))

  useEffect(() => {
    if (!virtualize) return
    const root = rootRef.current
    if (!root) return
    const scroller = scrollParentOf(root)

    const update = () => {
      const { scrollTop, viewport } = scrollMetrics(scroller)
      const rootTop = rootOffsetInScroller(root, scroller, scrollTop)
      const localTop = Math.max(0, scrollTop - rootTop)
      setWin(windowForScroll(localTop, viewport, offsets))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [offsets, virtualize])

  useEffect(() => {
    if (!virtualize || !selectedId) return
    const index = indexOfItemId(rows, selectedId)
    if (index < 0) return
    const root = rootRef.current
    if (!root) return
    const scroller = scrollParentOf(root)
    const y = offsets[index] ?? 0
    const h = itemHeight
    const { scrollTop, viewport } = scrollMetrics(scroller)
    const rootTop = rootOffsetInScroller(root, scroller, scrollTop)
    const localTop = scrollTop - rootTop
    if (y < localTop) setScrollTop(scroller, rootTop + y)
    else if (y + h > localTop + viewport)
      setScrollTop(scroller, rootTop + y + h - viewport)
  }, [selectedId, rows, offsets, itemHeight, virtualize])

  if (!virtualize) {
    return <div ref={rootRef}>{renderSlice(rows, 0, rows.length, ctx)}</div>
  }

  const { start, end } = win
  const padTop = offsets[start] ?? 0
  const padBottom = Math.max(0, total - (offsets[end] ?? total))

  return (
    <div ref={rootRef} style={{ height: total, position: 'relative' }}>
      <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
        {renderSlice(rows, start, end, ctx)}
      </div>
    </div>
  )
}

function renderSlice(
  rows: DoneFlatRow[],
  start: number,
  end: number,
  ctx: ListContext,
): ReactNode {
  const slice = rows.slice(start, end)
  const blocks: ReactNode[] = []
  let pending: DoneFlatRow[] = []

  const flushItems = () => {
    const items = pending
    pending = []
    if (!items.length) return
    blocks.push(
      <ul key={items[0]!.key} className="flex flex-col">
        {items.map((r) =>
          r.kind === 'project' ? (
            <ProjectRow key={r.key} project={r.item} />
          ) : r.kind === 'todo' ? (
            <TodoRow key={r.key} todo={r.item} ctx={ctx} />
          ) : null,
        )}
      </ul>,
    )
  }

  for (const r of slice) {
    if (r.kind === 'heading') {
      flushItems()
      blocks.push(
        <SectionHeading key={r.key} color="text-text-secondary">
          {formatDisplayDate(r.date)}
        </SectionHeading>,
      )
    } else {
      pending.push(r)
    }
  }
  flushItems()
  return blocks
}

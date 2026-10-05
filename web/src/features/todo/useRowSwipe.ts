import { useRef, useState, type PointerEvent } from 'react'

/** Movement before a touch counts as a swipe, and distance to act on it. */
const START_PX = 10
const COMMIT_PX = 72
const MAX_PX = 120
/** Touches starting this close to the left edge belong to "swipe back". */
export const EDGE_PX = 24

/**
 * Horizontal swipes on a row (PLAN.md §6, mobile). Vertical movement is
 * left to the browser (the row has `touch-action: pan-y`), and a quick
 * swipe moves too far for dnd-kit's long-press drag to start.
 */
export function useRowSwipe(actions: {
  onRight: () => void
  onLeft: () => void
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const swiped = useRef(false)

  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' || e.clientX < EDGE_PX) return
      start.current = { x: e.clientX, y: e.clientY, active: false }
      swiped.current = false
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s) return
      const mx = e.clientX - s.x
      const my = e.clientY - s.y
      if (!s.active) {
        if (Math.abs(my) > START_PX && Math.abs(my) >= Math.abs(mx)) {
          start.current = null // a scroll
          return
        }
        if (Math.abs(mx) < START_PX || Math.abs(mx) < Math.abs(my) * 1.5) return
        s.active = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      setDx(Math.max(-MAX_PX, Math.min(MAX_PX, mx)))
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = start.current
      start.current = null
      if (!s?.active) return
      swiped.current = true
      setDx(0)
      const mx = e.clientX - s.x
      if (mx > COMMIT_PX) actions.onRight()
      else if (mx < -COMMIT_PX) actions.onLeft()
    },
    onPointerCancel: () => {
      start.current = null
      setDx(0)
    },
  }

  /** True once after a swipe, so the click it produces can be ignored. */
  const consumeClick = () => {
    const was = swiped.current
    swiped.current = false
    return was
  }

  return { dx, handlers, consumeClick, committed: Math.abs(dx) > COMMIT_PX }
}

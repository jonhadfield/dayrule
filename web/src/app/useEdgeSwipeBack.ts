import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { EDGE_PX } from '../features/todo/useRowSwipe'
import { useUI } from './ui-state'

const BACK_PX = 80

/**
 * Swipe in from the left edge to go back to the lists (PLAN.md §6), like
 * the "Lists" link. Matters most in the installed app, which has no
 * browser back gesture. Not while the editor or a sheet is open.
 */
export function useEdgeSwipeBack(enabled: boolean) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      const ui = useUI.getState()
      start =
        e.pointerType !== 'mouse' &&
        e.clientX < EDGE_PX &&
        !ui.editingId &&
        !ui.panel
          ? { x: e.clientX, y: e.clientY }
          : null
    }
    const up = (e: PointerEvent) => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = Math.abs(e.clientY - start.y)
      start = null
      if (dx > BACK_PX && dx > dy * 2) void navigate({ to: '/' })
    }
    const cancel = () => (start = null)
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', cancel, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [enabled, navigate])
}

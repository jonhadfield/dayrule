import { useContext, useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { toLocalDate } from '../domain/dates'
import type { ListContext } from '../domain/lists'
import { withRepairs } from '../domain/repair'
import type { Entities } from '../domain/types'
import type { EntityStore } from '../store/store'
import { StoreContext } from './store-context'
import { useUI } from './ui-state'

export function useEntityStore(): EntityStore {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useEntityStore outside StoreProvider')
  return s
}

/** Subscribe to a slice of the entities. */
export function useEntities<T>(select: (e: Entities) => T): T {
  const s = useEntityStore()
  // The UI sees dangling references repaired (domain/repair.ts).
  return useStore(s.store, (state) => select(withRepairs(state.entities)))
}

/** All entities; components re-render on any change. Fine at to-do scale. */
export function useAllEntities(): Entities {
  return useEntities((e) => e)
}

function msUntilMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime() + 1000
}

/** Today's local date, updated at midnight and when the tab wakes up. */
export function useToday(): string {
  const [today, setToday] = useState(() => toLocalDate(new Date()))
  useEffect(() => {
    const refresh = () => setToday(toLocalDate(new Date()))
    let timer = setTimeout(function tick() {
      refresh()
      timer = setTimeout(tick, msUntilMidnight(new Date()))
    }, msUntilMidnight(new Date()))
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return today
}

export function useListContext(): ListContext {
  const today = useToday()
  const lingering = useUI((s) => s.lingering)
  const keepVisible = useMemo(
    () => new Set(Object.keys(lingering)),
    [lingering],
  )
  return { today, keepVisible }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Desktop layout: sidebar beside the list. Below this, mobile navigation. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 900px)')
}

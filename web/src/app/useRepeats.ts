import { useEffect } from 'react'
import { generateRepeats } from '../store/repeats'
import type { EntityStore } from '../store/store'

/**
 * Create repeating to-dos' instances as they come due (PLAN.md §4.2): when
 * the app opens, when the day changes, and shortly after any change (a new
 * rule, a completion, or templates arriving by sync). Generation is
 * idempotent, so running it often is harmless.
 */
export function useRepeats(store: EntityStore, today: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => store.generate((d, env) => generateRepeats(d, env))
    run()
    const off = store.subscribeChanges(() => {
      clearTimeout(timer)
      timer = setTimeout(run, 300)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [store, today])
}

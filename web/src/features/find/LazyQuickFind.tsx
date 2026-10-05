import { lazy, Suspense } from 'react'
import { useUI } from '../../app/ui-state'

const QuickFind = lazy(() => import('./QuickFind'))

/** Quick Find, fetched the first time it opens. */
export function LazyQuickFind() {
  const finding = useUI((s) => s.finding)
  if (finding === null) return null
  return (
    <Suspense fallback={null}>
      <QuickFind />
    </Suspense>
  )
}

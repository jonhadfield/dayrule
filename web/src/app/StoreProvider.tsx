import type { ReactNode } from 'react'
import type { EntityStore } from '../store/store'
import { StoreContext } from './store-context'

export function StoreProvider({
  store,
  children,
}: {
  store: EntityStore
  children: ReactNode
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

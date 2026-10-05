import { createContext } from 'react'
import type { EntityStore } from '../store/store'

export const StoreContext = createContext<EntityStore | null>(null)

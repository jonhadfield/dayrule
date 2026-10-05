import { Navigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useUI } from './ui-state'
import { Sidebar } from '../features/sidebar/Sidebar'
import { useIsDesktop } from './context'

/** Desktop opens Today; on mobile the list of lists is the home screen. */
export function Home() {
  const isDesktop = useIsDesktop()
  if (isDesktop) return <Navigate to="/today" replace />
  return (
    <div className="flex h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex items-center px-5 pt-5">
        <h1 className="flex-1 font-serif text-[34px] font-semibold tracking-tight">
          Dayrule
        </h1>
        <button
          type="button"
          aria-label="Quick Find"
          onClick={() => useUI.getState().find('')}
          className="rounded-full p-2 text-text-secondary"
        >
          <Search size={22} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Sidebar />
      </div>
    </div>
  )
}

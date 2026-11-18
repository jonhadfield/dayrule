import { Lock, Search, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { lock } from '../account/session'
import { useUI } from './ui-state'

/**
 * Mac-style Lock · Find · Settings glyphs for the desktop detail pane
 * (native `chromeToolbar`). Settings opens the same sidebar Settings popover.
 */
export function DesktopChrome() {
  return (
    <div
      role="toolbar"
      aria-label="App"
      className="pointer-events-none absolute top-3 right-4 z-20 flex gap-1.5"
    >
      <ChromeButton label="Lock (⇧⌘L)" onClick={() => void lock()}>
        <Lock size={16} strokeWidth={2.25} />
      </ChromeButton>
      <ChromeButton
        label="Find (⌘F)"
        onClick={() => useUI.getState().find('')}
      >
        <Search size={16} strokeWidth={2.25} />
      </ChromeButton>
      <ChromeButton
        label="Settings"
        onClick={() => useUI.getState().setSettingsOpen(true)}
      >
        <Settings size={16} strokeWidth={2.25} />
      </ChromeButton>
    </div>
  )
}

function ChromeButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="pointer-events-auto grid size-[30px] place-items-center rounded-full border border-text-secondary/45 bg-sidebar text-text hover:border-text-secondary"
    >
      {children}
    </button>
  )
}

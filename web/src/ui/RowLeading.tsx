import type { ReactNode } from 'react'

/**
 * Native `Tokens.rowLeadingSlot` (28px): centres the 20px checkbox / mark so
 * titles share one left edge with the page-title icon column.
 */
export function RowLeading({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-[var(--row-leading-slot)] shrink-0 place-items-center">
      {children}
    </span>
  )
}

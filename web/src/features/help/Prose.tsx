// Text styles for help articles: short sections, plain lists and tips.
import type { ReactNode } from 'react'

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 font-serif text-xl font-semibold">{children}</h2>
  )
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3">{children}</p>
}
export function List({
  children,
  ordered = false,
}: {
  children: ReactNode
  ordered?: boolean
}) {
  const cls = `mb-3 space-y-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`
  return ordered ? (
    <ol className={cls}>{children}</ol>
  ) : (
    <ul className={cls}>{children}</ul>
  )
}
/** A key or button name, shown like a key cap. */
export function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-hairline bg-sidebar px-1.5 py-0.5 font-sans text-[0.85em]">
      {children}
    </kbd>
  )
}
/** A short tip, set apart from the text. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="my-4 rounded-[8px] border-l-4 border-accent bg-sidebar/60 px-4 py-3 text-[0.95em]">
      {children}
    </p>
  )
}

import { useEffect, type ReactNode } from 'react'
import { setDocumentTitle } from '../../app/documentTitle'
import { Privacy } from './Privacy'
import { Terms } from './Terms'

/** The privacy notice and terms: public, no account needed (PLAN.md §17, decision 2). */
export function LegalPage({ path }: { path: string }) {
  useEffect(() => {
    setDocumentTitle(
      path === '/terms' ? 'Terms · Dayrule' : 'Privacy · Dayrule',
    )
  }, [path])

  return (
    <main className="mx-auto max-w-[680px] px-5 pt-[max(env(safe-area-inset-top),24px)] pb-16 leading-relaxed">
      <a href="/" className="text-accent hover:underline">
        ← Dayrule
      </a>
      {path === '/terms' ? <Terms /> : <Privacy />}
      <p className="mt-10 border-t border-hairline pt-4 text-sm text-text-secondary">
        <a href="/privacy" className="text-accent hover:underline">
          Privacy
        </a>{' '}
        ·{' '}
        <a href="/terms" className="text-accent hover:underline">
          Terms
        </a>
      </p>
    </main>
  )
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-6 mb-1 font-serif text-[32px] font-semibold tracking-tight">
      {children}
    </h1>
  )
}
export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 font-serif text-xl font-semibold">{children}</h2>
  )
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3">{children}</p>
}
export function List({ children }: { children: ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>
}

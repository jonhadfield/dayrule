import { useId, type ReactNode } from 'react'

/** Shared layout for the account screens. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pt-[12vh] pb-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 font-serif text-[34px] font-semibold tracking-tight">
          Dayrule
        </p>
        <h1 className="mb-1 font-serif text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="mb-5 text-sm text-text-secondary">{subtitle}</p>
        )}
        {children}
        <p className="mt-10 text-xs text-text-secondary">
          <a href="/help" className="hover:underline">
            Help
          </a>{' '}
          ·{' '}
          <a href="/privacy" className="hover:underline">
            Privacy
          </a>{' '}
          ·{' '}
          <a href="/terms" className="hover:underline">
            Terms
          </a>
        </p>
      </div>
    </main>
  )
}

export function Field({
  label,
  hint,
  ...input
}: {
  label: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        {...input}
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-[6px] border border-hairline bg-bg px-3 py-2 outline-none focus:border-accent"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Remember({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="mb-4 flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Stay unlocked on this device
        <span className="block text-xs text-text-secondary">
          Anyone who can use this device while it’s unlocked could open Dayrule.
          Leave off on shared devices.
        </span>
      </span>
    </label>
  )
}

export function Submit({
  busy,
  children,
}: {
  busy: boolean
  children: ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-full bg-text px-4 py-2.5 font-medium text-bg hover:bg-accent disabled:opacity-60"
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p
      role="alert"
      className="mb-3 rounded-[6px] bg-deadline/10 px-3 py-2 text-sm text-deadline"
    >
      {error}
    </p>
  )
}

export function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-accent hover:underline"
    >
      {children}
    </button>
  )
}

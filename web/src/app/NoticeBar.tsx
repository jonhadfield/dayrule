import { Undo2 } from 'lucide-react'
import { dismissNotice, useNotice } from './notice'

/** Bottom bar for the current notice; sits above the Add pill. */
export function NoticeBar() {
  const notice = useNotice((s) => s.current)
  if (!notice) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={notice.message}
      className="notice-in pointer-events-none fixed inset-x-3 z-40 mx-auto flex max-w-md justify-center md:left-[272px]"
      style={{
        bottom: 'max(calc(env(safe-area-inset-bottom) + 4.75rem), 5.5rem)',
      }}
    >
      <div className="pointer-events-auto flex w-full items-center gap-3 rounded-[6px] border border-hairline bg-sidebar px-4 py-3 shadow-md">
        {notice.kind === 'undo' && (
          <Undo2
            size={16}
            className="shrink-0 text-text-secondary"
            aria-hidden
          />
        )}
        {notice.kind === 'error' && (
          <span
            className="size-2 shrink-0 rounded-full bg-deadline"
            aria-hidden
          />
        )}
        <p className="min-w-0 flex-1 text-sm">{notice.message}</p>
        {notice.actionTitle && notice.action && (
          <button
            type="button"
            className="shrink-0 text-sm font-semibold text-accent hover:underline"
            onClick={() => {
              notice.action?.()
              dismissNotice()
            }}
          >
            {notice.actionTitle}
          </button>
        )}
      </div>
    </div>
  )
}

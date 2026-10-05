import { useNavigate, useRouterState } from '@tanstack/react-router'
import { FileText, Folder, Inbox, Layers } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useAllEntities, useToday } from '../../app/context'
import { useUI } from '../../app/ui-state'
import { buildFinder, type FindKind, type FindResult } from '../../domain/find'

const ICONS: Record<FindKind, typeof Inbox> = {
  list: Inbox,
  area: Layers,
  project: Folder,
  todo: FileText,
}

/**
 * Search everything (PLAN.md §7): type anywhere, ⌘F or ⌘/. Loaded on first
 * use (see LazyQuickFind), which keeps MiniSearch out of the initial bundle.
 */
export default function QuickFind() {
  const e = useAllEntities()
  const today = useToday()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The query lives in the store, so keys typed before the field has focus
  // (buffered by useGlobalKeys) are never lost.
  const query = useUI((s) => s.finding) ?? ''
  const [active, setActive] = useState(0)
  // Built once per opening, from what's there now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const finder = useMemo(() => buildFinder(e, { today }), [])
  const results = useMemo(() => finder.search(query), [finder, query])
  const close = () => useUI.getState().find(null)

  const open = (r: FindResult) => {
    const ui = useUI.getState()
    ui.find(null)
    // The layout selects or opens the to-do once its list shows.
    if (r.todoId) ui.focusAfterNavigation({ todoId: r.todoId, path: r.path })
    if (r.path !== pathname) void navigate({ to: r.path })
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      const n = results.length
      if (n) setActive((a) => (a + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (ev.key === 'Enter' && results[active]) {
      ev.preventDefault()
      open(results[active])
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-bg px-3 pt-[max(env(safe-area-inset-top),12px)] outline-none md:inset-auto md:top-[12vh] md:left-1/2 md:max-h-[70vh] md:w-[min(560px,calc(100vw-24px))] md:-translate-x-1/2 md:rounded-[10px] md:border md:border-hairline md:p-2 md:shadow-lg"
        >
          <Dialog.Title className="sr-only">Quick Find</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-hairline pb-2">
            <input
              autoFocus
              value={query}
              onChange={(ev) => {
                useUI.getState().find(ev.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Find to-dos, projects, lists…"
              aria-label="Find"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={results.length > 0 ? 'find-results' : undefined}
              aria-activedescendant={
                results[active] ? `find-${active}` : undefined
              }
              enterKeyHint="go"
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-lg outline-none"
            />
            <Dialog.Close className="px-2 text-accent md:hidden">
              Cancel
            </Dialog.Close>
          </div>
          {/* The listbox exists only with options in it (ARIA requires them). */}
          {results.length > 0 && (
            <ul
              id="find-results"
              role="listbox"
              aria-label="Results"
              className="min-h-0 flex-1 overflow-y-auto py-1"
            >
              {results.map((r, i) => {
                const Icon = ICONS[r.kind]
                return (
                  <li
                    key={r.id}
                    id={`find-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => open(r)}
                    className={`flex cursor-default items-center gap-3 rounded-[6px] px-2 py-2 ${i === active ? 'bg-accent/10' : ''}`}
                  >
                    <Icon
                      size={16}
                      className="shrink-0 text-text-secondary"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.title}</span>
                      <span className="block truncate text-xs text-text-secondary">
                        {r.detail}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <p
              role="status"
              className="px-2 py-6 text-center text-sm text-text-secondary"
            >
              Nothing found.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

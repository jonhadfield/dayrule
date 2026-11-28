import { Dialog } from 'radix-ui'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useEntityStore } from '../../app/context'
import { useUI } from '../../app/ui-state'
import * as cmd from '../../store/commands'

/** Quick Entry host: shown while the ⌃Space modal is open. */
export function QuickEntryHost() {
  const open = useUI((s) => s.quickEntry)
  return open ? <QuickEntry /> : null
}

/**
 * Modal to file a to-do into Inbox without leaving the current list
 * (PLAN.md §8.4). Enter adds and keeps the modal open for the next one.
 */
function QuickEntry() {
  const store = useEntityStore()
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const close = () => useUI.getState().setQuickEntry(false)

  const add = () => {
    const t = title.trim()
    if (!t) return
    store.run(`Add ${t}`, (d, env) => {
      cmd.createTodo(d, env, { title: t, placement: { list: 'inbox' } })
    })
    setTitle('')
    // Keep focus for the next to-do.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    add()
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      close()
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col justify-start bg-bg px-3 pt-[max(env(safe-area-inset-top),12px)] outline-none md:inset-auto md:top-[18vh] md:left-1/2 md:w-[min(560px,calc(100vw-24px))] md:-translate-x-1/2 md:rounded-[10px] md:border md:border-hairline md:p-3 md:shadow-lg"
        >
          <Dialog.Title className="sr-only">Quick Entry</Dialog.Title>
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              placeholder="New to-do in Inbox"
              aria-label="New to-do in Inbox"
              enterKeyHint="done"
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-lg outline-none"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-[6px] px-3 py-1.5 text-accent disabled:opacity-40"
            >
              Add
            </button>
            <Dialog.Close className="px-2 text-text-secondary md:hidden">
              Cancel
            </Dialog.Close>
          </form>
          <p className="px-2 pt-1 text-xs text-text-secondary">
            Enter adds to Inbox. Escape closes.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

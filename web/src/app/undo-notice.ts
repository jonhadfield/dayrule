// Visible Undo for the same actions as the native apps (PLAN.md §7.4).
// Completing, canceling, trashing, When, Move, Empty Trash.

import { useEffect } from 'react'
import { dismissUndo, postUndo } from './notice'
import { useEntityStore } from './context'
import type { Change } from '../store/draft'
import type { EntityStore } from '../store/store'

function titleOf(changes: Change[]): string | undefined {
  for (const c of changes) {
    if (c.kind !== 'entity' || c.collection !== 'todos' || !c.after) continue
    const title = (c.after as { title?: string }).title?.trim()
    if (title) return title
  }
}

function whenMessage(changes: Change[]): string {
  for (const c of changes) {
    if (c.kind !== 'entity' || c.collection !== 'todos' || !c.after) continue
    const start = (c.after as { start?: unknown }).start
    if (start === 'today') return 'Moved to Today'
    if (start === 'ready') return 'Moved to Backlog'
    if (start === 'later') return 'Moved to Not now'
    if (start === 'inbox') return 'Moved to Inbox'
    if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start))
      return 'Scheduled'
  }
  return 'When updated'
}

/** Copy for the bar, or undefined when this command shouldn't show one. */
export function undoMessage(
  label: string,
  changes: Change[],
): string | undefined {
  const title = titleOf(changes)
  switch (label) {
    case 'Complete':
      return title ? `Completed ${title}` : 'Completed'
    case 'Cancel':
      return title ? `Canceled ${title}` : 'Canceled'
    case 'Move to Trash':
    case 'Trash':
    case 'Trash Area':
    case 'Trash Project':
      return title ? `Moved ${title} to Trash` : 'Moved to Trash'
    case 'When':
      return whenMessage(changes)
    case 'Empty Trash':
      return 'Emptied Trash'
    case 'Move to Done':
      return 'Moved completed to-dos to Done'
    case 'Move':
      return 'Moved'
    default:
      if (label.startsWith('Drop on ')) return 'Moved'
      return undefined
  }
}

/**
 * Subscribe to local store commands and post (or dismiss) the Undo bar.
 * Undo itself only runs if the stack is still the same depth as when posted.
 */
export function attachUndoNotices(store: EntityStore): () => void {
  let prevLen = store.store.getState().past.length
  return store.subscribeChanges((_, { source }) => {
    const past = store.store.getState().past
    const len = past.length
    const grew = len > prevLen
    const shrunk = len < prevLen
    prevLen = len
    if (source !== 'local') return
    if (shrunk) {
      dismissUndo()
      return
    }
    if (!grew) return
    const entry = past[past.length - 1]
    if (!entry) return
    const message = undoMessage(entry.label, entry.changes)
    if (!message) {
      dismissUndo()
      return
    }
    const depth = len
    postUndo(message, () => {
      if (store.store.getState().past.length === depth) store.undo()
    })
  })
}

/** Wire the store's undoable commands to the notice channel. */
export function useUndoNotice() {
  const store = useEntityStore()
  useEffect(() => attachUndoNotices(store), [store])
}

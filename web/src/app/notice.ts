// One in-app notice at a time (error, info, or Undo). Never sent as a
// system notification, so decrypted text stays in the page (PLAN.md §7.4).

import { create } from 'zustand'

export type NoticeKind = 'undo' | 'error' | 'info'

export interface Notice {
  id: number
  kind: NoticeKind
  message: string
  actionTitle?: string
  action?: () => void
}

let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined

export const useNotice = create<{ current: Notice | null }>(() => ({
  current: null,
}))

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

export function postNotice(n: Omit<Notice, 'id'>): void {
  clearTimer()
  const notice: Notice = { ...n, id: nextId++ }
  useNotice.setState({ current: notice })
  const ms = n.kind === 'undo' ? 5000 : 4000
  timer = setTimeout(() => {
    if (useNotice.getState().current?.id === notice.id) {
      useNotice.setState({ current: null })
    }
  }, ms)
}

export function postUndo(message: string, undo: () => void): void {
  postNotice({
    kind: 'undo',
    message,
    actionTitle: 'Undo',
    action: undo,
  })
}

export function dismissNotice(): void {
  clearTimer()
  useNotice.setState({ current: null })
}

/** Drop a visible Undo: a later change means it no longer names the top entry. */
export function dismissUndo(): void {
  if (useNotice.getState().current?.kind !== 'undo') return
  dismissNotice()
}

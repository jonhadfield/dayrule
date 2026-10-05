import {
  CalendarDays,
  CheckCheck,
  Hourglass,
  ListTodo,
  Mailbox,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

export type ListKey =
  'inbox' | 'today' | 'scheduled' | 'backlog' | 'done' | 'trash'

export const LISTS: {
  key: ListKey
  title: string
  icon: LucideIcon
  color: string
}[] = [
  { key: 'inbox', title: 'Inbox', icon: Mailbox, color: 'text-text' },
  { key: 'today', title: 'Today', icon: Sun, color: 'text-today' },
  {
    key: 'scheduled',
    title: 'Scheduled',
    icon: CalendarDays,
    color: 'text-scheduled',
  },
  { key: 'backlog', title: 'Backlog', icon: ListTodo, color: 'text-ready' },
  { key: 'done', title: 'Done', icon: CheckCheck, color: 'text-done' },
  { key: 'trash', title: 'Trash', icon: Trash2, color: 'text-text-secondary' },
]

export function listMeta(key: ListKey) {
  const meta = LISTS.find((l) => l.key === key)
  if (!meta) throw new Error(`unknown list ${key}`)
  return meta
}

/** Backlog's section for things put aside (stored as `start: 'later'`). */
export const NOT_NOW = {
  title: 'Not now',
  icon: Hourglass,
  color: 'text-later',
}

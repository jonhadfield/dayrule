// Keyboard shortcuts (PLAN.md §7.2). Browsers reserve ⌘N, ⌘T, ⌘W and
// ⌘1–9, so single letters (when not typing) and "G then …" sequences
// stand in for them.

export interface Binding {
  /** e.g. "mod+k", "shift+t", "g i", "?" */
  keys: string
  description: string
  group: 'Create' | 'Edit' | 'Schedule' | 'Navigate' | 'Select'
  /** Allowed while focus is in a text field (only modifier combos). */
  whileTyping?: boolean
}

export const BINDINGS: Binding[] = [
  { keys: 'n', description: 'New to-do', group: 'Create' },
  {
    keys: 'alt+n',
    description: 'New to-do',
    group: 'Create',
    whileTyping: true,
  },
  {
    keys: 'shift+n',
    description: 'New heading (in a project)',
    group: 'Create',
  },
  {
    keys: 'alt+p',
    description: 'New project',
    group: 'Create',
    whileTyping: true,
  },
  { keys: 'enter', description: 'Open selected to-do', group: 'Edit' },
  {
    keys: 'escape',
    description: 'Close to-do',
    group: 'Edit',
    whileTyping: true,
  },
  {
    keys: 'mod+k',
    description: 'Complete / reopen',
    group: 'Edit',
    whileTyping: true,
  },
  {
    keys: 'alt+mod+k',
    description: 'Cancel',
    group: 'Edit',
    whileTyping: true,
  },
  { keys: 'shift+t', description: 'Tags…', group: 'Edit' },
  {
    keys: 'shift+mod+c',
    description: 'Add checklist item',
    group: 'Edit',
    whileTyping: true,
  },
  { keys: 'shift+m', description: 'Move…', group: 'Edit' },
  { keys: 'backspace', description: 'Move to Trash', group: 'Edit' },
  { keys: 'mod+z', description: 'Undo', group: 'Edit' },
  { keys: 'shift+mod+z', description: 'Redo', group: 'Edit' },
  { keys: 'mod+s', description: 'When…', group: 'Schedule', whileTyping: true },
  { keys: 't', description: 'Today', group: 'Schedule' },
  { keys: 'b', description: 'Backlog', group: 'Schedule' },
  { keys: 'shift+b', description: 'Not now', group: 'Schedule' },
  {
    keys: 'shift+mod+d',
    description: 'Deadline…',
    group: 'Schedule',
    whileTyping: true,
  },
  { keys: 'g i', description: 'Go to Inbox', group: 'Navigate' },
  { keys: 'g t', description: 'Go to Today', group: 'Navigate' },
  { keys: 'g s', description: 'Go to Scheduled', group: 'Navigate' },
  { keys: 'g b', description: 'Go to Backlog', group: 'Navigate' },
  { keys: 'g d', description: 'Go to Done', group: 'Navigate' },
  { keys: 'g x', description: 'Go to Trash', group: 'Navigate' },
  { keys: 'up', description: 'Select previous', group: 'Select' },
  { keys: 'down', description: 'Select next', group: 'Select' },
  { keys: 'shift+up', description: 'Extend selection up', group: 'Select' },
  { keys: 'shift+down', description: 'Extend selection down', group: 'Select' },
  { keys: 'mod+a', description: 'Select all', group: 'Select' },
  { keys: 'mod+up', description: 'Move item up', group: 'Select' },
  { keys: 'mod+down', description: 'Move item down', group: 'Select' },
  { keys: '?', description: 'Show shortcuts', group: 'Navigate' },
  {
    keys: 'mod+f',
    description: 'Quick Find (or just start typing)',
    group: 'Navigate',
    whileTyping: true,
  },
  {
    keys: 'mod+/',
    description: 'Quick Find',
    group: 'Navigate',
    whileTyping: true,
  },
]

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * Normalise a key event to "alt+mod+shift+key". Letters use `code`, so
 * Option+N reads as "alt+n" on a Mac (where `key` would be "˜").
 */
export function comboOf(e: KeyboardEvent): string {
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (e.key === 'ArrowUp') key = 'up'
  else if (e.key === 'ArrowDown') key = 'down'
  else if (e.key === '?') return '?'
  else key = e.key.toLowerCase()

  const parts: string[] = []
  if (e.altKey) parts.push('alt')
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/** How a combo is shown to people: ⌘⇧D on a Mac, Ctrl+Shift+D elsewhere. */
export function displayKeys(keys: string): string {
  return keys
    .split(' ')
    .map((combo) =>
      combo
        .split('+')
        .map((k) => {
          if (k === 'mod') return isMac ? '⌘' : 'Ctrl+'
          if (k === 'alt') return isMac ? '⌥' : 'Alt+'
          if (k === 'shift') return isMac ? '⇧' : 'Shift+'
          if (k === 'up') return '↑'
          if (k === 'down') return '↓'
          if (k === 'enter') return '↵'
          if (k === 'escape') return 'Esc'
          if (k === 'backspace') return isMac ? '⌫' : 'Backspace'
          return k.length === 1 ? k.toUpperCase() : k
        })
        .join(''),
    )
    .join(' then ')
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

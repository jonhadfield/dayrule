// Android PWA Web Share Target → Inbox to-do (PLAN.md §8.3 / §8.4).

import { useUI } from '../../app/ui-state'
import type { EntityStore } from '../../store/store'
import * as cmd from '../../store/commands'

export type SharedFields = { title: string; notes: string }

/**
 * Map share_target query params (title / text / url) into a to-do.
 * Returns null when none of the params are present.
 */
export function fieldsFromShareParams(q: URLSearchParams): SharedFields | null {
  const title = q.get('title')?.trim() ?? ''
  const text = q.get('text')?.trim() ?? ''
  const url = q.get('url')?.trim() ?? ''
  if (!title && !text && !url) return null

  let t = title
  const notes: string[] = []
  if (text) {
    if (!t) {
      const [first = '', ...rest] = text.split('\n')
      t = first.trim()
      const more = rest.join('\n').trim()
      if (more) notes.push(more)
    } else if (text !== title) {
      notes.push(text)
    }
  }
  if (!t && url) t = url
  else if (url && url !== t && url !== text) notes.push(url)

  return { title: t, notes: notes.join('\n\n') }
}

/** Create an Inbox to-do from a share and open it for editing. */
export function startSharedTodo(
  store: EntityStore,
  fields: SharedFields,
): void {
  const label = fields.title ? `Share ${fields.title}` : 'Share link'
  const id = store.run(label, (d, env) => {
    const todo = cmd.createTodo(d, env, {
      title: fields.title,
      notes: fields.notes,
      placement: { list: 'inbox' },
    })
    return todo.id
  })
  useUI.getState().edit(id)
}

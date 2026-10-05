import { Check, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useEntities, useEntityStore } from '../../app/context'
import { compareKeys } from '../../domain/order'
import * as cmd from '../../store/commands'
import { Popover } from '../../ui/Popover'
import { useInSheet } from '../../ui/sheet-context'

/** Toggle tags on one item; type a new name to create a tag. */
export function TagPanel({
  itemId,
  current,
}: {
  itemId: string
  current: string[]
}) {
  const inSheet = useInSheet()
  const store = useEntityStore()
  const tags = useEntities((e) => e.tags)
  const [text, setText] = useState('')
  const sorted = Object.values(tags).sort((a, b) =>
    compareKeys(a.order, b.order),
  )
  const matches = sorted.filter((t) =>
    t.title.toLowerCase().includes(text.trim().toLowerCase()),
  )
  const exact = sorted.some(
    (t) => t.title.toLowerCase() === text.trim().toLowerCase(),
  )

  const toggle = (tagId: string) => {
    const next = current.includes(tagId)
      ? current.filter((t) => t !== tagId)
      : [...current, tagId]
    store.run('Tags', (d, env) => cmd.setTags(d, env, [itemId], next))
  }

  const create = () => {
    const title = text.trim()
    if (!title) return
    store.run('New Tag', (d, env) => {
      const tag = cmd.createTag(d, env, { title })
      cmd.setTags(d, env, [itemId], [...current, tag.id])
    })
    setText('')
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!exact) create()
        }}
      >
        <input
          autoFocus={!inSheet}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Find or create a tag"
          aria-label="Tag name"
          className="mb-1 w-full rounded-[6px] border border-hairline bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
      </form>
      <div className="max-h-64 overflow-y-auto">
        {matches.map((t) => (
          <button
            key={t.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-sidebar"
            onClick={() => toggle(t.id)}
          >
            <span className="w-4">
              {current.includes(t.id) && (
                <Check size={14} className="text-accent" />
              )}
            </span>
            {t.parentId && tags[t.parentId]
              ? `${tags[t.parentId]?.title} › ${t.title}`
              : t.title}
          </button>
        ))}
        {text.trim() !== '' && !exact && (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-accent hover:bg-sidebar"
            onClick={create}
          >
            <Plus size={14} /> Create “{text.trim()}”
          </button>
        )}
        {sorted.length === 0 && text === '' && (
          <p className="px-2 py-1.5 text-sm text-text-secondary">
            No tags yet. Type to create one.
          </p>
        )}
      </div>
    </>
  )
}

/** Tag panel in a popover, opened from a button. */
export function TagPicker({
  itemId,
  current,
  trigger,
}: {
  itemId: string
  current: string[]
  trigger: ReactNode
}) {
  return (
    <Popover title="Tags" trigger={trigger}>
      <TagPanel itemId={itemId} current={current} />
    </Popover>
  )
}

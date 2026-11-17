import { useDraggable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, Plus } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useAllEntities, useEntityStore, useIsDesktop } from '../../app/context'
import { effectiveTagIds, type Item } from '../../domain/lists'
import { compareKeys } from '../../domain/order'
import type { OrderField, Placement, When } from '../../store/commands'
import { useUI } from '../../app/ui-state'
import { RowLeading } from '../../ui/RowLeading'
import { useSelectionBarShown } from '../todo/selection'
import { startNewTodo } from '../todo/editing'

interface Props {
  icon?: ReactNode
  title: ReactNode
  /** Where the Add button puts things; omit to hide the button. */
  newTodo?: { placement: Placement; when?: When }
  actions?: ReactNode
  children: ReactNode
  empty?: boolean
  emptyIcon?: ReactNode
  /** Which ordering this list shows (Today has its own). */
  orderField?: OrderField
  /** Set on a project page, for "new heading". */
  projectId?: string
}

export function ListShell({
  icon,
  title,
  newTodo,
  actions,
  children,
  empty,
  emptyIcon,
  orderField = 'order',
  projectId,
}: Props) {
  const store = useEntityStore()
  const isDesktop = useIsDesktop()
  // The selection bar takes the Add button's place while it shows.
  const selecting = useSelectionBarShown()
  const placement = newTodo?.placement ?? null
  const placementKey = JSON.stringify(placement)

  // Keyboard commands (N, ⌘↑/↓, ⇧N) need to know about the current list.
  useEffect(() => {
    useUI.getState().setListContext({
      placement:
        placementKey === 'null'
          ? null
          : (JSON.parse(placementKey) as Placement),
      orderField,
      projectId: projectId ?? null,
    })
  }, [placementKey, orderField, projectId])
  return (
    <div className="list-in relative mx-auto w-full max-w-[var(--reading-max-width)] px-[var(--list-chrome-inset)] pt-4 pb-28 md:pt-10">
      {!isDesktop && (
        <Link
          to="/"
          className="-ml-1 mb-2 flex items-center gap-0.5 text-accent"
        >
          <ChevronLeft size={20} /> Lists
        </Link>
      )}
      <header className="mb-4 flex items-center gap-[var(--row-glyph-spacing)] border-b border-hairline pb-2">
        {icon != null && <RowLeading>{icon}</RowLeading>}
        <h1 className="min-w-0 flex-1 font-serif text-[30px] font-semibold tracking-tight">
          {title}
        </h1>
        {actions}
      </header>
      {children}
      {empty && (
        <div
          className="mt-24 flex justify-center opacity-15 grayscale [&_svg]:size-28"
          aria-hidden
        >
          {emptyIcon}
        </div>
      )}
      {newTodo && !selecting && (
        <AddButton
          onAdd={() => startNewTodo(store, newTodo.placement, newTodo.when)}
        />
      )}
    </div>
  )
}

/** Tags used by the items in a list, as filter chips (PLAN.md §4.1). */
export function TagFilterBar({
  items,
  selected,
  onSelect,
}: {
  items: Item[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const e = useAllEntities()
  const used = new Set<string>()
  for (const i of items) for (const id of effectiveTagIds(e, i)) used.add(id)
  const tags = [...used]
    .map((id) => e.tags[id])
    .filter((t) => t !== undefined)
    .sort((a, b) => compareKeys(a.order, b.order))
  if (tags.length === 0) return null

  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected === id}
      className={`rounded-full border px-3 py-0.5 text-sm ${selected === id ? 'border-accent bg-accent text-white' : 'border-hairline text-text-secondary hover:text-text'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chip(null, 'All')}
      {tags.map((t) => chip(t.id, t.title))}
    </div>
  )
}

export function SectionHeading({
  children,
  color = 'text-accent',
}: {
  children: ReactNode
  color?: string
}) {
  return (
    <h2
      className={`mt-6 mb-1 border-b border-hairline pb-1 text-[13px] font-semibold ${color}`}
    >
      {children}
    </h2>
  )
}

/**
 * The Add pill: tap for a to-do at the end of the list, or drag it into
 * the list to insert one at that position (PLAN.md §5.2).
 */
function AddButton({ onAdd }: { onAdd: () => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: 'add-button',
    data: { type: 'add' },
  })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      type="button"
      aria-label="Add to-do"
      title="Add to-do (N) · drag into the list to place it"
      onClick={onAdd}
      className={`fixed bottom-[max(env(safe-area-inset-bottom),20px)] left-1/2 z-30 flex -translate-x-1/2 touch-none items-center gap-1.5 rounded-full bg-text px-5 py-2.5 font-medium text-bg shadow-md hover:bg-accent md:left-[calc(50%+(var(--sidebar-width)/2))] ${isDragging ? 'opacity-40' : ''}`}
    >
      <Plus size={18} /> Add
    </button>
  )
}

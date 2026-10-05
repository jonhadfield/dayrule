import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { DropAction, DropData } from './types'

/** Wraps a sidebar row so to-dos can be dropped onto it. */
export function DropTarget({
  id,
  action,
  label,
  children,
}: {
  id: string
  action: DropAction | undefined
  label: string
  children: ReactNode
}) {
  const data: DropData | undefined = action
    ? { type: 'sidebar', action, label }
    : undefined
  const { setNodeRef, isOver } = useDroppable({
    id: `sidebar:${id}`,
    data,
    disabled: !action,
  })
  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'rounded-[4px] bg-accent/20 ring-1 ring-accent' : ''}
    >
      {children}
    </div>
  )
}

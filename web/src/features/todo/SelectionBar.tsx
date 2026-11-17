import {
  CalendarDays,
  CircleCheck,
  Flag,
  MoveRight,
  Trash2,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEntityStore } from '../../app/context'
import { useUI } from '../../app/ui-state'
import * as cmd from '../../store/commands'
import { useSelectionBarShown } from './selection'

/**
 * Actions for the selection, where the Add button usually is: in mobile
 * selection mode, and on desktop when several to-dos are selected.
 */
export function SelectionBar() {
  const store = useEntityStore()
  const shown = useSelectionBarShown()
  const ids = useUI((s) => s.selectedIds)
  if (!shown) return null

  const ui = useUI.getState()
  const n = ids.length
  /** Act on the selection, then leave selection mode. */
  const finish = (run: () => void) => {
    run()
    ui.stopSelecting()
  }

  return (
    <div
      role="toolbar"
      aria-label="Selected to-dos"
      className="fixed inset-x-3 z-30 mx-auto flex max-w-md md:left-[calc(var(--sidebar-width)+12px)] items-center gap-1 rounded-full bg-text px-2 py-1.5 text-bg shadow-md"
      style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)' }}
    >
      <Action label="Cancel selection" onClick={() => ui.stopSelecting()}>
        <X size={18} />
      </Action>
      <span className="flex-1 text-center text-sm" aria-live="polite">
        {n === 0 ? 'Tap to-dos' : `${n} selected`}
      </span>
      <Action label="When" disabled={!n} onClick={() => ui.openPanel('when')}>
        <CalendarDays size={18} />
      </Action>
      <Action
        label="Deadline"
        disabled={!n}
        onClick={() => ui.openPanel('deadline')}
      >
        <Flag size={18} />
      </Action>
      <Action label="Move" disabled={!n} onClick={() => ui.openPanel('move')}>
        <MoveRight size={18} />
      </Action>
      <Action
        label="Complete"
        disabled={!n}
        onClick={() =>
          finish(() =>
            store.run('Complete', (d, env) =>
              cmd.setStatus(d, env, ids, 'completed'),
            ),
          )
        }
      >
        <CircleCheck size={18} />
      </Action>
      <Action
        label="Move to Trash"
        disabled={!n}
        onClick={() =>
          finish(() =>
            store.run('Move to Trash', (d, env) => cmd.trashItems(d, env, ids)),
          )
        }
      >
        <Trash2 size={18} />
      </Action>
    </div>
  )
}

function Action({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full hover:bg-bg/15 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

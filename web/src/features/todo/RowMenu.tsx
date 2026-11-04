import { useNavigate } from '@tanstack/react-router'
import { ContextMenu } from 'radix-ui'
import type { ReactNode } from 'react'
import { useEntityStore } from '../../app/context'
import { useUI, type PanelKind } from '../../app/ui-state'
import * as cmd from '../../store/commands'

const item =
  'flex cursor-default items-center justify-between gap-6 rounded-[6px] px-2 py-1.5 outline-none data-[highlighted]:bg-sidebar'

/**
 * Right-click menu on a to-do (desktop, PLAN.md §6). It acts on the
 * selection if the row is part of it, otherwise on that row alone.
 */
export function RowMenu({
  todoId,
  children,
}: {
  todoId: string
  children: ReactNode
}) {
  const store = useEntityStore()
  const navigate = useNavigate()
  const targets = () => {
    const ui = useUI.getState()
    if (ui.selectedIds.includes(todoId)) return ui.selectedIds
    ui.select(todoId)
    return [todoId]
  }
  const panel = (kind: PanelKind) => () =>
    useUI.getState().openPanel(kind, targets())
  const status =
    (s: 'completed' | 'canceled' | 'open', label: string) => () => {
      const ids = targets()
      store.run(label, (d, env) => cmd.setStatus(d, env, ids, s))
    }

  return (
    <ContextMenu.Root
      // Select the row as the menu opens, so it's clear what it acts on.
      onOpenChange={(open) => open && targets()}
    >
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[200px] rounded-[8px] border border-hairline bg-bg p-1 text-sm shadow-lg">
          <ContextMenu.Item className={item} onSelect={panel('when')}>
            When…
          </ContextMenu.Item>
          <ContextMenu.Item className={item} onSelect={panel('deadline')}>
            Deadline…
          </ContextMenu.Item>
          <ContextMenu.Item className={item} onSelect={panel('tags')}>
            Tags…
          </ContextMenu.Item>
          <ContextMenu.Item className={item} onSelect={panel('move')}>
            Move…
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-hairline" />
          <ContextMenu.Item
            className={item}
            onSelect={status('completed', 'Complete')}
          >
            Complete
          </ContextMenu.Item>
          <ContextMenu.Item
            className={item}
            onSelect={status('canceled', 'Cancel')}
          >
            Cancel
          </ContextMenu.Item>
          <ContextMenu.Item
            className={item}
            onSelect={status('open', 'Reopen')}
          >
            Reopen
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-hairline" />
          <ContextMenu.Item
            className={item}
            onSelect={() => {
              const project = store.run('Convert to Project', (d, env) =>
                cmd.convertTodoToProject(d, env, todoId),
              )
              useUI.getState().select(null)
              void navigate({
                to: '/project/$projectId',
                params: { projectId: project.id },
              })
            }}
          >
            Convert to Project
          </ContextMenu.Item>
          <ContextMenu.Item
            className={`${item} text-deadline`}
            onSelect={() => {
              const ids = targets()
              store.run('Move to Trash', (d, env) =>
                cmd.trashItems(d, env, ids),
              )
            }}
          >
            Move to Trash
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

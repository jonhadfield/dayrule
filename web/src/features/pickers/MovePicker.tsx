import { Box, ListTodo, Mailbox } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAllEntities, useEntityStore } from '../../app/context'
import { projectProgress } from '../../domain/lists'
import { compareKeys } from '../../domain/order'
import * as cmd from '../../store/commands'
import { Popover } from '../../ui/Popover'
import { Progress } from '../../ui/Progress'

/** Move to-dos to the Inbox, an area or a project. */
export function MovePanel({
  ids,
  onDone,
}: {
  ids: string[]
  onDone: () => void
}) {
  const store = useEntityStore()
  const e = useAllEntities()
  const { areas, projects } = e

  const move = (target: cmd.MoveTarget) => {
    store.run('Move', (d, env) => cmd.moveTodos(d, env, ids, target))
    onDone()
  }

  const live = Object.values(projects)
    .filter((p) => !p.trashedAt && p.status === 'open')
    .sort((a, b) => compareKeys(a.order, b.order))
  const liveAreas = Object.values(areas)
    .filter((a) => !a.trashedAt)
    .sort((a, b) => compareKeys(a.order, b.order))

  const row = (
    key: string,
    icon: ReactNode,
    label: string,
    target: cmd.MoveTarget,
    indent = false,
  ) => (
    <button
      key={key}
      type="button"
      className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-sidebar ${indent ? 'pl-7' : ''}`}
      onClick={() => move(target)}
    >
      {icon}
      <span className="truncate">{label || 'Untitled'}</span>
    </button>
  )

  return (
    <>
      <div className="max-h-80 overflow-y-auto">
        {row('inbox', <Mailbox size={16} />, 'Inbox', {
          kind: 'inbox',
        })}
        {row(
          'none',
          <ListTodo size={16} className="text-ready" />,
          'No project or area',
          { kind: 'none' },
        )}
        {live
          .filter(
            (p) => !p.areaId || !areas[p.areaId] || areas[p.areaId]?.trashedAt,
          )
          .map((p) =>
            row(p.id, <Progress {...projectProgress(e, p.id)} />, p.title, {
              kind: 'project',
              projectId: p.id,
            }),
          )}
        {liveAreas.map((a) => [
          row(
            a.id,
            <Box size={16} className="text-text-secondary" />,
            a.title,
            { kind: 'area', areaId: a.id },
          ),
          ...live
            .filter((p) => p.areaId === a.id)
            .map((p) =>
              row(
                p.id,
                <Progress {...projectProgress(e, p.id)} />,
                p.title,
                { kind: 'project', projectId: p.id },
                true,
              ),
            ),
        ])}
      </div>
    </>
  )
}

/** Move panel in a popover, opened from a button. */
export function MovePicker({
  ids,
  trigger,
}: {
  ids: string[]
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover title="Move" open={open} onOpenChange={setOpen} trigger={trigger}>
      <MovePanel ids={ids} onDone={() => setOpen(false)} />
    </Popover>
  )
}

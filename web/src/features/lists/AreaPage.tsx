import { useNavigate, useParams } from '@tanstack/react-router'
import { Box, FolderPlus, Trash2 } from 'lucide-react'
import {
  useAllEntities,
  useEntityStore,
  useListContext,
} from '../../app/context'
import { areaView } from '../../domain/lists'
import * as cmd from '../../store/commands'
import { ItemList } from '../todo/ItemList'
import { ListShell, SectionHeading } from './ListShell'

export function AreaPage() {
  const { areaId } = useParams({ from: '/area/$areaId' })
  const store = useEntityStore()
  const e = useAllEntities()
  const ctx = useListContext()
  const navigate = useNavigate()
  const view = areaView(e, areaId, ctx)
  if (!view) return <ListShell title="Area not found">{null}</ListShell>
  const { area } = view

  return (
    <ListShell
      icon={<Box size={26} className="text-text-secondary" />}
      title={
        <input
          value={area.title}
          placeholder="New Area"
          aria-label="Area title"
          onChange={(ev) =>
            store.run('Rename Area', (d, env) =>
              cmd.renameArea(d, env, area.id, ev.target.value),
            )
          }
          className="w-full bg-transparent outline-none"
        />
      }
      newTodo={{ placement: { list: 'area', areaId: area.id } }}
      actions={
        <>
          <button
            type="button"
            aria-label="New project in this area"
            className="rounded-[6px] p-1 text-text-secondary hover:bg-sidebar"
            onClick={() => {
              const p = store.run('New Project', (d, env) =>
                cmd.createProject(d, env, { title: '', areaId: area.id }),
              )
              void navigate({
                to: '/project/$projectId',
                params: { projectId: p.id },
              })
            }}
          >
            <FolderPlus size={20} />
          </button>
          <button
            type="button"
            aria-label="Move area to Trash"
            className="rounded-[6px] p-1 text-text-secondary hover:bg-sidebar hover:text-deadline"
            onClick={() => {
              store.run('Trash Area', (d, env) =>
                cmd.trashItems(d, env, [area.id]),
              )
              void navigate({ to: '/' })
            }}
          >
            <Trash2 size={20} />
          </button>
        </>
      }
    >
      <ItemList items={view.projects} ctx={ctx} />
      {view.todos.length > 0 && view.projects.length > 0 && (
        <SectionHeading color="text-text-secondary">To-Dos</SectionHeading>
      )}
      <ItemList
        items={view.todos}
        ctx={ctx}
        showContainer={false}
        group={{
          id: `a:${area.id}`,
          drop: { kind: 'move', target: { kind: 'area', areaId: area.id } },
          place: { list: 'area', areaId: area.id },
        }}
      />
    </ListShell>
  )
}

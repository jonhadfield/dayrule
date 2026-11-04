import { useNavigate, useParams } from '@tanstack/react-router'
import {
  Check,
  Ellipsis,
  Heading as HeadingIcon,
  ListTodo,
  Trash2,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import {
  useAllEntities,
  useEntityStore,
  useListContext,
} from '../../app/context'
import { formatDisplayDate } from '../../domain/dates'
import { homeOf } from '../../domain/find'
import { projectProgress, projectView } from '../../domain/lists'
import * as cmd from '../../store/commands'
import { Progress } from '../../ui/Progress'
import { WhenPicker } from '../pickers/WhenPicker'
import { DeadlinePicker } from '../pickers/DeadlinePicker'
import { startNewTodo } from '../todo/editing'
import { ItemList } from '../todo/ItemList'
import { ListShell } from './ListShell'

const menuItem =
  'flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 outline-none data-[highlighted]:bg-sidebar'

export function ProjectPage() {
  const { projectId } = useParams({ from: '/project/$projectId' })
  const store = useEntityStore()
  const e = useAllEntities()
  const ctx = useListContext()
  const navigate = useNavigate()
  const view = projectView(e, projectId, ctx)

  if (!view) return <ListShell title="Project not found">{null}</ListShell>
  const { project } = view
  const progress = projectProgress(e, project.id)

  return (
    <ListShell
      icon={
        <Progress
          {...progress}
          className="w-8"
          completed={project.status === 'completed'}
        />
      }
      title={
        <input
          value={project.title}
          placeholder="New Project"
          aria-label="Project title"
          onChange={(ev) =>
            store.run('Rename', (d, env) =>
              cmd.updateProject(d, env, project.id, { title: ev.target.value }),
            )
          }
          className="w-full bg-transparent outline-none"
        />
      }
      newTodo={{ placement: { list: 'project', projectId: project.id } }}
      projectId={project.id}
      actions={
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Project actions"
              className="rounded-[6px] p-1 text-text-secondary hover:bg-sidebar"
            >
              <Ellipsis size={20} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-48 rounded-[12px] border border-hairline bg-bg p-1 shadow-lg"
            >
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() =>
                  store.run('New Heading', (d, env) =>
                    cmd.createHeading(d, env, project.id, 'New Heading'),
                  )
                }
              >
                <HeadingIcon size={14} /> Add Heading
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() =>
                  store.run(
                    project.status === 'open'
                      ? 'Complete Project'
                      : 'Reopen Project',
                    (d, env) =>
                      cmd.setStatus(
                        d,
                        env,
                        [project.id],
                        project.status === 'open' ? 'completed' : 'open',
                      ),
                  )
                }
              >
                <Check size={14} />{' '}
                {project.status === 'open'
                  ? 'Complete Project'
                  : 'Reopen Project'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() => {
                  const todo = store.run('Convert to To-Do', (d, env) =>
                    cmd.convertProjectToTodo(d, env, project.id),
                  )
                  void navigate({
                    to: homeOf(store.entities, todo, ctx).path,
                  })
                }}
              >
                <ListTodo size={14} /> Convert to To-Do
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={`${menuItem} text-deadline`}
                onSelect={() => {
                  store.run('Trash Project', (d, env) =>
                    cmd.trashItems(d, env, [project.id]),
                  )
                  void navigate({ to: '/' })
                }}
              >
                <Trash2 size={14} /> Move to Trash
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      }
    >
      <textarea
        value={project.notes}
        placeholder="Notes"
        aria-label="Project notes"
        rows={Math.max(1, project.notes.split('\n').length)}
        onChange={(ev) =>
          store.run('Edit', (d, env) =>
            cmd.updateProject(d, env, project.id, { notes: ev.target.value }),
          )
        }
        className="mb-2 w-full resize-none bg-transparent text-text-secondary outline-none"
      />
      <div className="mb-4 flex gap-2 text-sm text-text-secondary">
        <WhenPicker
          ids={[project.id]}
          trigger={
            <button
              type="button"
              className="rounded-[6px] px-2 py-0.5 hover:bg-sidebar"
            >
              {project.start === 'later'
                ? 'Not now'
                : project.startDate
                  ? `When: ${formatDisplayDate(project.startDate)}`
                  : 'When'}
            </button>
          }
        />
        <DeadlinePicker
          ids={[project.id]}
          trigger={
            <button
              type="button"
              className="rounded-[6px] px-2 py-0.5 hover:bg-sidebar"
            >
              {project.deadline
                ? `Deadline: ${formatDisplayDate(project.deadline)}`
                : 'Deadline'}
            </button>
          }
        />
      </div>

      <ItemList
        items={view.todos}
        ctx={ctx}
        showContainer={false}
        group={{
          id: `p:${project.id}`,
          drop: {
            kind: 'move',
            target: { kind: 'project', projectId: project.id },
          },
          place: { list: 'project', projectId: project.id },
        }}
      />

      {view.headings.map(({ heading, todos }) => (
        <section key={heading.id}>
          <div className="mt-6 mb-1 flex items-center gap-2 border-b border-hairline pb-1">
            <input
              value={heading.title}
              aria-label="Heading"
              onChange={(ev) =>
                store.run('Rename Heading', (d, env) =>
                  cmd.updateHeading(d, env, heading.id, {
                    title: ev.target.value,
                  }),
                )
              }
              className="min-w-0 flex-1 bg-transparent font-serif text-[15px] font-semibold text-accent outline-none"
            />
            <button
              type="button"
              className="text-xs text-text-secondary hover:text-text"
              onClick={() =>
                startNewTodo(store, {
                  list: 'project',
                  projectId: project.id,
                  headingId: heading.id,
                })
              }
            >
              Add
            </button>
            <button
              type="button"
              className="text-xs text-text-secondary hover:text-text"
              onClick={() =>
                store.run('Archive Heading', (d, env) =>
                  cmd.updateHeading(d, env, heading.id, { archived: true }),
                )
              }
            >
              Archive
            </button>
            <button
              type="button"
              aria-label="Delete heading"
              className="text-text-secondary hover:text-deadline"
              onClick={() =>
                store.run('Delete Heading', (d, env) =>
                  cmd.deleteHeading(d, env, heading.id),
                )
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
          <ItemList
            items={todos}
            ctx={ctx}
            showContainer={false}
            group={{
              id: `h:${heading.id}`,
              drop: {
                kind: 'move',
                target: {
                  kind: 'project',
                  projectId: project.id,
                  headingId: heading.id,
                },
              },
              place: {
                list: 'project',
                projectId: project.id,
                headingId: heading.id,
              },
            }}
          />
        </section>
      ))}
    </ListShell>
  )
}

import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Box, Plus, Settings } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import {
  useAllEntities,
  useEntityStore,
  useListContext,
} from '../../app/context'
import { projectProgress, sidebarCounts } from '../../domain/lists'
import { compareKeys } from '../../domain/order'
import type { DoneMode, Project } from '../../domain/types'
import * as cmd from '../../store/commands'
import { LISTS } from '../../ui/lists'
import { Popover } from '../../ui/Popover'
import { Progress } from '../../ui/Progress'
import { SyncStatus } from './SyncStatus'
import { APP_VERSION } from '../../app/pwa'
import { lock, signOut, useAccount } from '../../account/session'
import { AccountDialog } from '../../account/AccountDialog'
import { DropTarget } from '../dnd/DropTarget'
import type { DropAction } from '../dnd/types'
import type { ListKey } from '../../ui/lists'

/** What dropping to-dos onto each fixed list does. */
const LIST_DROPS: Record<ListKey, DropAction | undefined> = {
  inbox: { kind: 'move', target: { kind: 'inbox' } },
  today: { kind: 'when', when: { kind: 'today' } },
  scheduled: undefined, // needs a date: use the When picker
  backlog: { kind: 'when', when: { kind: 'ready' } },
  done: { kind: 'complete' },
  trash: { kind: 'trash' },
}
import { saveTheme, storedTheme, type Theme } from '../../app/theme'

const rowClass =
  'flex min-h-[var(--row-height)] items-center gap-2.5 border-l-[3px] border-transparent px-2 text-[15px] hover:bg-hairline/50 [&.active]:border-accent [&.active]:font-semibold'

export function Sidebar() {
  const store = useEntityStore()
  const e = useAllEntities()
  const ctx = useListContext()
  const navigate = useNavigate()
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const accountEmail = useAccount((s) => s.profile?.email ?? '')
  const [accountOpen, setAccountOpen] = useState(false)
  const counts = sidebarCounts(e, ctx)

  const projects = Object.values(e.projects)
    .filter((p) => !p.trashedAt && p.status === 'open' && p.start !== 'later')
    .sort((a, b) => compareKeys(a.order, b.order))
  const areas = Object.values(e.areas)
    .filter((a) => !a.trashedAt)
    .sort((a, b) => compareKeys(a.order, b.order))
  const looseProjects = projects.filter(
    (p) => !p.areaId || !e.areas[p.areaId] || e.areas[p.areaId]?.trashedAt,
  )

  const projectLink = (p: Project) => (
    <DropTarget
      key={p.id}
      id={`project:${p.id}`}
      label={p.title || 'project'}
      action={{ kind: 'move', target: { kind: 'project', projectId: p.id } }}
    >
      <Link
        to="/project/$projectId"
        params={{ projectId: p.id }}
        className={rowClass}
      >
        <Progress {...projectProgress(e, p.id)} />
        <span className="truncate">{p.title || 'New Project'}</span>
      </Link>
    </DropTarget>
  )

  const newProject = () => {
    const p = store.run('New Project', (d, env) =>
      cmd.createProject(d, env, { title: '' }),
    )
    void navigate({ to: '/project/$projectId', params: { projectId: p.id } })
  }
  const newArea = () => {
    const a = store.run('New Area', (d, env) => cmd.createArea(d, env, ''))
    void navigate({ to: '/area/$areaId', params: { areaId: a.id } })
  }

  return (
    <nav aria-label="Lists" className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-3">
        <ul className="flex flex-col">
          {LISTS.map(({ key, title, icon: Icon, color }) => {
            const count =
              key === 'inbox'
                ? counts.inbox
                : key === 'today'
                  ? counts.today
                  : 0
            return (
              <li
                key={key}
                className={key === 'today' || key === 'done' ? 'mt-3' : ''}
              >
                <DropTarget id={key} label={title} action={LIST_DROPS[key]}>
                  <Link to={`/${key}`} className={rowClass}>
                    <Icon size={18} className={color} />
                    <span className="flex-1">{title}</span>
                    {key === 'today' && counts.overdue > 0 && (
                      <span
                        className="rounded-full bg-deadline px-1.5 text-xs font-semibold text-white"
                        aria-label={`${counts.overdue} overdue`}
                      >
                        {counts.overdue}
                      </span>
                    )}
                    {count > 0 && (
                      <span className="text-sm text-text-secondary">
                        {count}
                      </span>
                    )}
                  </Link>
                </DropTarget>
              </li>
            )
          })}
        </ul>

        {looseProjects.length > 0 && (
          <div className="mt-5 flex flex-col">
            {looseProjects.map(projectLink)}
          </div>
        )}

        {areas.map((a) => (
          <div key={a.id} className="mt-5 flex flex-col">
            <DropTarget
              id={`area:${a.id}`}
              label={a.title || 'area'}
              action={{ kind: 'move', target: { kind: 'area', areaId: a.id } }}
            >
              <Link
                to="/area/$areaId"
                params={{ areaId: a.id }}
                className={`${rowClass} font-semibold`}
              >
                <Box size={18} className="text-text-secondary" />
                <span className="truncate">{a.title || 'New Area'}</span>
              </Link>
            </DropTarget>
            {projects.filter((p) => p.areaId === a.id).map(projectLink)}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 border-t border-hairline px-3 py-2">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-sm text-text-secondary hover:bg-hairline/60"
            >
              <Plus size={16} /> New List
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={4}
              className="z-50 min-w-44 rounded-[12px] border border-hairline bg-bg p-1 shadow-lg"
            >
              <DropdownMenu.Item
                className="cursor-default rounded-[6px] px-2 py-1.5 outline-none data-[highlighted]:bg-sidebar"
                onSelect={newProject}
              >
                New Project
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-default rounded-[6px] px-2 py-1.5 outline-none data-[highlighted]:bg-sidebar"
                onSelect={newArea}
              >
                New Area
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="flex-1" />
        <Popover
          title="Settings"
          align="end"
          trigger={
            <button
              type="button"
              aria-label="Settings"
              className="rounded-[6px] p-1 text-text-secondary hover:bg-hairline/60"
            >
              <Settings size={16} />
            </button>
          }
        >
          <label className="flex flex-col gap-1 px-2 py-1 text-sm">
            Move completed items to Done
            <select
              value={e.settings.moveToDone}
              onChange={(ev) =>
                store.run('Logging', (d) =>
                  cmd.setDoneMode(d, ev.target.value as DoneMode),
                )
              }
              className="rounded-[6px] border border-hairline bg-bg px-2 py-1"
            >
              <option value="immediately">Immediately</option>
              <option value="daily">Daily</option>
              <option value="manually">Manually</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 px-2 py-1 text-sm">
            Appearance
            <select
              value={theme}
              onChange={(ev) => {
                const next = ev.target.value as Theme
                saveTheme(next)
                setTheme(next)
              }}
              className="rounded-[6px] border border-hairline bg-bg px-2 py-1"
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="mt-2 border-t border-hairline px-2 pt-2 text-sm">
            <p className="truncate text-text-secondary" title={accountEmail}>
              {accountEmail}
            </p>
            <div className="mt-1 flex flex-wrap gap-3">
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => setAccountOpen(true)}
              >
                Account…
              </button>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void lock()}
              >
                Lock now
              </button>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
          <div className="px-2 pt-2">
            <SyncStatus />
            <p className="mt-1 text-xs text-text-secondary">
              Version {APP_VERSION} ·{' '}
              <a
                href="/help"
                target="_blank"
                rel="noopener"
                className="text-accent hover:underline"
              >
                Help
              </a>
            </p>
          </div>
        </Popover>
      </div>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </nav>
  )
}

import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  useAllEntities,
  useEntityStore,
  useListContext,
} from '../../app/context'
import { fromLocalDate } from '../../domain/dates'
import * as lists from '../../domain/lists'
import { filterByTag } from '../../domain/lists'
import * as cmd from '../../store/commands'
import { listMeta, NOT_NOW, type ListKey } from '../../ui/lists'
import { ItemList } from '../todo/ItemList'
import type { Group } from '../dnd/types'
import { ListShell, SectionHeading, TagFilterBar } from './ListShell'
import { VirtualDoneList } from './VirtualDoneList'

function header(list: ListKey) {
  const meta = listMeta(list)
  const Icon = meta.icon
  return { icon: <Icon size={26} className={meta.color} />, title: meta.title }
}

/** Drop group for a Backlog section: dropping in moves to that container. */
function backlogGroup(c: lists.Container): Group {
  if (c.kind === 'project') {
    return {
      id: `p:${c.project.id}`,
      drop: {
        kind: 'move',
        target: { kind: 'project', projectId: c.project.id },
      },
      place: { list: 'project', projectId: c.project.id },
    }
  }
  if (c.kind === 'area') {
    return {
      id: `a:${c.area.id}`,
      drop: { kind: 'move', target: { kind: 'area', areaId: c.area.id } },
      place: { list: 'area', areaId: c.area.id },
    }
  }
  return { id: 'backlog', drop: { kind: 'move', target: { kind: 'none' } } }
}

function useTagFilter() {
  return useState<string | null>(null)
}

export function InboxPage() {
  const e = useAllEntities()
  const ctx = useListContext()
  const [tag, setTag] = useTagFilter()
  const items = lists.inbox(e, ctx)
  const shown = filterByTag(e, items, tag)
  const h = header('inbox')
  return (
    <ListShell
      {...h}
      newTodo={{ placement: { list: 'inbox' } }}
      empty={items.length === 0}
      emptyIcon={h.icon}
    >
      <TagFilterBar items={items} selected={tag} onSelect={setTag} />
      <ItemList items={shown} ctx={ctx} group={{ id: 'inbox' }} />
    </ListShell>
  )
}

export function TodayPage() {
  const e = useAllEntities()
  const ctx = useListContext()
  const [tag, setTag] = useTagFilter()
  const all = lists.today(e, ctx)
  const h = header('today')
  return (
    <ListShell
      {...h}
      newTodo={{ placement: { list: 'today' } }}
      orderField="todayOrder"
      empty={all.length === 0}
      emptyIcon={h.icon}
    >
      <TagFilterBar items={all} selected={tag} onSelect={setTag} />
      <ItemList
        items={filterByTag(e, all, tag)}
        ctx={ctx}
        group={{
          id: 'today',
          drop: { kind: 'when', when: { kind: 'today' } },
          place: { list: 'today' },
        }}
      />
    </ListShell>
  )
}

const weekday = (d: string) =>
  fromLocalDate(d).toLocaleDateString('en-GB', { weekday: 'long' })

export function ScheduledPage() {
  const e = useAllEntities()
  const ctx = useListContext()
  const u = lists.scheduled(e, ctx)
  const h = header('scheduled')
  const tomorrow = u.days[0]?.date
  return (
    <ListShell
      {...h}
      newTodo={
        tomorrow
          ? {
              placement: { list: 'ready' },
              when: { kind: 'date', date: tomorrow },
            }
          : undefined
      }
    >
      {u.days.map((day, i) => (
        <section key={day.date}>
          <SectionHeading color="text-text">
            <span className="text-[17px] font-bold">
              {fromLocalDate(day.date).getDate()}
            </span>{' '}
            <span className="text-text-secondary">
              {i === 0 ? 'Tomorrow' : weekday(day.date)}
            </span>
          </SectionHeading>
          <ItemList
            items={day.items}
            ctx={ctx}
            group={{
              id: `day:${day.date}`,
              drop: { kind: 'when', when: { kind: 'date', date: day.date } },
            }}
          />
        </section>
      ))}
      {u.months.map((m) => (
        <section key={m.month}>
          <SectionHeading color="text-text">
            {fromLocalDate(`${m.month}-01`).toLocaleDateString('en-GB', {
              month: 'long',
              year: 'numeric',
            })}
          </SectionHeading>
          <ItemList
            items={m.items}
            ctx={ctx}
            showStartDate
            group={{ id: `month:${m.month}` }}
          />
        </section>
      ))}
      {u.waiting.length > 0 && (
        <section>
          <SectionHeading color="text-text">
            Waiting to be completed
          </SectionHeading>
          <ItemList items={u.waiting} ctx={ctx} group={{ id: 'waiting' }} />
        </section>
      )}
    </ListShell>
  )
}

/**
 * Backlog: what could be done any time, grouped by where it lives, with
 * "Not now" (put aside for the moment) at the end.
 */
export function BacklogPage() {
  const e = useAllEntities()
  const ctx = useListContext()
  const [tag, setTag] = useTagFilter()
  const groups = lists.backlog(e, ctx)
  const notNow = lists.notNow(e, ctx)
  const all = groups.flatMap((g) => g.todos)
  const h = header('backlog')
  const NotNowIcon = NOT_NOW.icon
  return (
    <ListShell
      {...h}
      newTodo={{ placement: { list: 'ready' } }}
      empty={all.length + notNow.projects.length + notNow.todos.length === 0}
      emptyIcon={h.icon}
    >
      <TagFilterBar items={all} selected={tag} onSelect={setTag} />
      {groups.map((g) => {
        const todos = filterByTag(e, g.todos, tag)
        if (todos.length === 0) return null
        const c = g.container
        const key =
          c.kind === 'none'
            ? 'none'
            : c.kind === 'area'
              ? c.area.id
              : c.project.id
        return (
          <section key={key}>
            {c.kind !== 'none' && (
              <SectionHeading color="text-text">
                {c.kind === 'project' ? (
                  <Link
                    to="/project/$projectId"
                    params={{ projectId: c.project.id }}
                  >
                    {c.project.title || 'New Project'}
                  </Link>
                ) : (
                  <Link to="/area/$areaId" params={{ areaId: c.area.id }}>
                    {c.area.title || 'New Area'}
                  </Link>
                )}
              </SectionHeading>
            )}
            <ItemList
              items={todos}
              ctx={ctx}
              showContainer={false}
              group={backlogGroup(c)}
            />
          </section>
        )
      })}
      {notNow.projects.length + notNow.todos.length > 0 && (
        <section>
          <SectionHeading color={NOT_NOW.color}>
            <span className="flex items-center gap-1">
              <NotNowIcon size={13} /> {NOT_NOW.title}
            </span>
          </SectionHeading>
          <ItemList items={notNow.projects} ctx={ctx} />
          <ItemList
            items={notNow.todos}
            ctx={ctx}
            group={{
              id: 'not-now',
              drop: { kind: 'when', when: { kind: 'later' } },
              place: { list: 'later' },
            }}
          />
        </section>
      )}
    </ListShell>
  )
}

export function DonePage() {
  const store = useEntityStore()
  const e = useAllEntities()
  const ctx = useListContext()
  const days = lists.doneList(e, ctx)
  const h = header('done')
  return (
    <ListShell
      {...h}
      empty={days.length === 0}
      emptyIcon={h.icon}
      actions={
        e.settings.moveToDone === 'manually' ? (
          <button
            type="button"
            className="rounded-[6px] px-2 py-1 text-sm text-accent hover:bg-sidebar"
            onClick={() =>
              store.run('Move to Done', (d, env) => cmd.moveToDoneNow(d, env))
            }
          >
            Move to Done now
          </button>
        ) : null
      }
    >
      <VirtualDoneList days={days} ctx={ctx} />
    </ListShell>
  )
}

export function TrashPage() {
  const store = useEntityStore()
  const e = useAllEntities()
  const t = lists.trash(e)
  const h = header('trash')
  const empty = t.items.length + t.areas.length === 0
  const restore = (id: string) =>
    store.run('Restore', (d, env) => cmd.restoreItems(d, env, [id]))
  return (
    <ListShell
      {...h}
      empty={empty}
      emptyIcon={h.icon}
      actions={
        !empty && (
          <button
            type="button"
            className="rounded-[6px] px-2 py-1 text-sm text-deadline hover:bg-sidebar"
            onClick={() => store.run('Empty Trash', (d) => cmd.emptyTrash(d))}
          >
            Empty Trash
          </button>
        )
      }
    >
      <ul className="flex flex-col">
        {[...t.areas, ...t.items].map((i) => (
          <li
            key={i.id}
            className="flex min-h-[var(--row-height)] items-center gap-3 border-b border-hairline px-1 hover:bg-sidebar/60"
          >
            <span className="min-w-0 flex-1 truncate text-text-secondary">
              {i.title || 'Untitled'}
              <span className="ml-2 text-xs">
                {i.type === 'area'
                  ? 'Area'
                  : i.type === 'project'
                    ? 'Project'
                    : ''}
              </span>
            </span>
            <button
              type="button"
              className="text-sm text-accent"
              onClick={() => restore(i.id)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </ListShell>
  )
}

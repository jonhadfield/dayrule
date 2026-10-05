import { withRepairs } from '../domain/repair'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { closeEditor, startNewTodo } from '../features/todo/editing'
import * as cmd from '../store/commands'
import { useEntityStore } from './context'
import { BINDINGS, comboOf, isTyping } from './keymap'
import { targetIds, useUI, visibleTodoIds } from './ui-state'

const GO: Record<string, string> = {
  i: '/inbox',
  t: '/today',
  s: '/scheduled',
  b: '/backlog',
  d: '/done',
  x: '/trash',
}

const WHEN: Record<string, cmd.When> = {
  t: { kind: 'today' },
  b: { kind: 'ready' },
  'shift+b': { kind: 'later' },
}

/** All keyboard shortcuts (PLAN.md §7.2), dispatched from one listener. */
export function useGlobalKeys() {
  const store = useEntityStore()
  const navigate = useNavigate()

  useEffect(() => {
    let pendingG: ReturnType<typeof setTimeout> | null = null

    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing) return
      const ui = useUI.getState()
      if (ui.panel) return // the open dialog handles its own keys
      const typing = isTyping(ev.target)
      const printable =
        !ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        ev.key.length === 1 &&
        ev.key.trim() !== ''

      if (ui.finding !== null) {
        // Quick Find loads on first use: keep what's typed before its field
        // exists. Once the field has focus, it takes the keys itself.
        if (!typing && printable) {
          ev.preventDefault()
          ui.find(ui.finding + ev.key)
        } else if (!typing && ev.key === 'Escape') {
          ui.find(null)
        }
        return
      }

      const combo = comboOf(ev)
      const binding = BINDINGS.find((b) => b.keys === combo)

      // "G then …" navigation.
      if (pendingG && !typing) {
        clearTimeout(pendingG)
        pendingG = null
        const to = GO[combo]
        if (to) {
          ev.preventDefault()
          void navigate({ to })
        }
        return
      }
      if (combo === 'g' && !typing) {
        pendingG = setTimeout(() => (pendingG = null), 1500)
        return
      }

      // Start typing anywhere to find: any printable key without a
      // shortcut of its own opens Quick Find with that character.
      if (!binding && !typing && printable) {
        ev.preventDefault()
        ui.find(ev.key)
        return
      }

      if (!binding || (typing && !binding.whileTyping)) return

      const ids = targetIds()
      const visible = visibleTodoIds()
      const run = (fn: () => void) => {
        ev.preventDefault()
        fn()
      }

      switch (combo) {
        case 'n':
        case 'alt+n':
          if (ui.placement) run(() => startNewTodo(store, ui.placement!))
          return
        case 'shift+n':
          if (ui.projectId) {
            run(() =>
              store.run('New Heading', (d, env) =>
                cmd.createHeading(d, env, ui.projectId!, 'New Heading'),
              ),
            )
          }
          return
        case 'alt+p':
          return run(() => {
            const p = store.run('New Project', (d, env) =>
              cmd.createProject(d, env, { title: '' }),
            )
            void navigate({
              to: '/project/$projectId',
              params: { projectId: p.id },
            })
          })
        case 'mod+f':
        case 'mod+/':
          return run(() => ui.find(''))
        case 'enter':
          if (!ui.editingId && ui.selectedIds[0])
            run(() => ui.edit(ui.selectedIds[0]!))
          return
        case 'escape':
          if (ui.editingId) return run(() => closeEditor(store))
          if (ui.selectedIds.length) run(() => ui.select(null))
          return
        case 'mod+k': {
          if (!ids.length) return
          const allDone = ids.every(
            (id) => store.entities.todos[id]?.status === 'completed',
          )
          return run(() =>
            store.run(allDone ? 'Reopen' : 'Complete', (d, env) =>
              cmd.setStatus(d, env, ids, allDone ? 'open' : 'completed'),
            ),
          )
        }
        case 'alt+mod+k':
          if (ids.length) {
            run(() =>
              store.run('Cancel', (d, env) =>
                cmd.setStatus(d, env, ids, 'canceled'),
              ),
            )
          }
          return
        case 'mod+s':
          if (ids.length) run(() => ui.openPanel('when'))
          return
        case 'shift+mod+d':
          if (ids.length) run(() => ui.openPanel('deadline'))
          return
        case 'shift+t':
          if (ids.length === 1) run(() => ui.openPanel('tags'))
          return
        case 'shift+m':
          if (ids.length) run(() => ui.openPanel('move'))
          return
        case 'shift+mod+c': {
          const id = ids[0]
          if (!id) return
          return run(() => {
            if (ui.editingId !== id) ui.edit(id)
            store.run('Checklist', (d, env) =>
              cmd.addChecklistItem(d, env, id, ''),
            )
          })
        }
        case 't':
        case 'b':
        case 'shift+b': {
          const when = WHEN[combo]
          if (ids.length && when) {
            run(() =>
              store.run('When', (d, env) => cmd.setWhen(d, env, ids, when)),
            )
          }
          return
        }
        case 'backspace':
          if (ids.length && !ui.editingId) {
            run(() => {
              store.run('Trash', (d, env) => cmd.trashItems(d, env, ids))
              ui.select(null)
            })
          }
          return
        case 'mod+z':
          return run(() => void store.undo())
        case 'shift+mod+z':
          return run(() => void store.redo())
        case 'up':
        case 'down': {
          if (!visible.length || ui.editingId) return
          const current = ui.selectedIds[ui.selectedIds.length - 1]
          const i = current ? visible.indexOf(current) : -1
          const next =
            i === -1
              ? combo === 'down'
                ? visible[0]
                : visible[visible.length - 1]
              : visible[
                  Math.max(
                    0,
                    Math.min(
                      visible.length - 1,
                      i + (combo === 'down' ? 1 : -1),
                    ),
                  )
                ]
          if (next) run(() => ui.select(next))
          return
        }
        case 'shift+up':
        case 'shift+down': {
          const current =
            ui.selectedIds[ui.selectedIds.length - 1] ?? ui.anchorId
          const i = current ? visible.indexOf(current) : -1
          const next =
            visible[
              Math.max(
                0,
                Math.min(
                  visible.length - 1,
                  i + (combo === 'shift+down' ? 1 : -1),
                ),
              )
            ]
          if (next) run(() => ui.extendTo(next, visible))
          return
        }
        case 'mod+a':
          if (visible.length && !ui.editingId)
            run(() => ui.setSelection(visible))
          return
        case 'mod+up':
        case 'mod+down':
          if (ids.length === 1)
            run(() => moveSelected(ids[0]!, combo === 'mod+down' ? 1 : -1))
          return
        case '?':
          return run(() => ui.openPanel('help'))
      }
    }

    /** Swap the item one place up or down among its displayed siblings. */
    const moveSelected = (id: string, dir: 1 | -1) => {
      const { orderField } = useUI.getState()
      // Siblings as displayed, so with dangling references repaired.
      const e = withRepairs(store.entities)
      const me = e.todos[id]
      if (!me) return
      const sameContainer = (other: string) => {
        const t = e.todos[other]
        if (!t) return false
        if (orderField === 'todayOrder') return true
        return (
          t.projectId === me.projectId &&
          t.headingId === me.headingId &&
          t.areaId === me.areaId
        )
      }
      const siblings = visibleTodoIds().filter(sameContainer)
      const i = siblings.indexOf(id)
      if (i === -1) return
      const rest = siblings.filter((x) => x !== id)
      const target = Math.max(0, Math.min(rest.length, i + dir))
      if (target === i) return
      store.run('Move', (d, env) =>
        cmd.reorder(d, env, 'todos', id, orderField, {
          before: rest[target - 1],
          after: rest[target],
        }),
      )
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (pendingG) clearTimeout(pendingG)
    }
  }, [store, navigate])
}

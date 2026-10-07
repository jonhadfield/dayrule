import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { closeEditor, startNewTodo } from '../features/todo/editing'
import { useEntityStore, useIsDesktop, useToday } from './context'
import { useRepeats } from './useRepeats'
import { useUI, visibleTodoIds } from './ui-state'
import { Sidebar } from '../features/sidebar/Sidebar'
import { useGlobalKeys } from './useGlobalKeys'
import { KeyboardPanels } from '../features/pickers/KeyboardPanels'
import { DragLayer } from '../features/dnd/DragLayer'
import { QuickFindHost } from '../features/find/QuickFind'
import { MobileEditor } from '../features/todo/MobileEditor'
import { SelectionBar } from '../features/todo/SelectionBar'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

/** Desktop: sidebar beside the list. Mobile: one screen at a time. */
export function Layout() {
  useGlobalKeys()
  const isDesktop = useIsDesktop()
  const store = useEntityStore()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  useRepeats(store, useToday())
  useEdgeSwipeBack(!isDesktop && pathname !== '/')

  // Completing a to-do by any route (checkbox, ⌘K, drop on Done) lets it
  // linger in its list for a moment before it moves to Done.
  useEffect(
    () =>
      store.subscribeChanges((changes, { source }) => {
        // Only completions made here linger; synced ones just move.
        if (source !== 'local') return
        const closed: string[] = []
        const reopened: string[] = []
        for (const c of changes) {
          if (c.kind !== 'entity' || c.collection !== 'todos') continue
          const before = c.before as { status?: string } | undefined
          const after = c.after as { status?: string } | undefined
          if (before?.status === 'open' && after && after.status !== 'open')
            closed.push(c.id)
          if (before && before.status !== 'open' && after?.status === 'open')
            reopened.push(c.id)
        }
        useUI.getState().linger(closed)
        useUI.getState().stopLingering(reopened)
      }),
    [store],
  )

  // Keep the selection to what's on screen: an action can move selected
  // to-dos out of the list (Later, Move, Trash), and completed ones leave
  // when they stop lingering.
  useEffect(() => {
    let frame = 0
    const prune = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const ui = useUI.getState()
        if (!ui.selectedIds.length || ui.editingId) return
        const visible = new Set(visibleTodoIds())
        const kept = ui.selectedIds.filter((id) => visible.has(id))
        if (kept.length !== ui.selectedIds.length) ui.setSelection(kept)
      })
    }
    const offStore = store.subscribeChanges(prune)
    const offUI = useUI.subscribe((s, prev) => {
      if (s.lingering !== prev.lingering) prune()
    })
    return () => {
      cancelAnimationFrame(frame)
      offStore()
      offUI()
    }
  }, [store])

  // Changing list closes any open editor and clears the selection.
  useEffect(() => {
    closeEditor(store)
    useUI.getState().stopSelecting()
  }, [pathname, store])

  // Quick Find chose a to-do: once its list shows, select it (desktop) or
  // open it (mobile). Runs after the effect above has cleared selection.
  const pendingFocus = useUI((s) => s.pendingFocus)
  useEffect(() => {
    if (!pendingFocus || pendingFocus.path !== pathname) return
    const ui = useUI.getState()
    ui.focusAfterNavigation(null)
    if (!isDesktop) return ui.edit(pendingFocus.todoId)
    ui.select(pendingFocus.todoId)
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-todo-id="${CSS.escape(pendingFocus.todoId)}"]`)
        ?.scrollIntoView({ block: 'center' }),
    )
  }, [pendingFocus, pathname, isDesktop])

  // The installed app's "New to-do" shortcut opens /inbox?add=1.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('add') !== '1') return
    void navigate({ to: '/inbox', replace: true })
    startNewTodo(store, { list: 'inbox' })
  }, [navigate, store])

  if (!isDesktop) {
    return (
      <DragLayer>
        <div className="min-h-full touch-pan-y touch-pinch-zoom">
          <Outlet />
          <MobileEditor />
          <SelectionBar />
          <KeyboardPanels />
          <QuickFindHost />
        </div>
      </DragLayer>
    )
  }
  return (
    <DragLayer>
      <div className="flex h-full">
        <aside className="w-[260px] shrink-0 border-r border-hairline bg-sidebar">
          <Sidebar />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <KeyboardPanels />
        <QuickFindHost />
        <SelectionBar />
      </div>
    </DragLayer>
  )
}

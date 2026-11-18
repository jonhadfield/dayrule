// Transient UI state: selection, the open editor, the current list's
// context for keyboard commands, and keyboard-opened panels.
import { create } from 'zustand'
import type { OrderField, Placement } from '../store/commands'

export type PanelKind = 'when' | 'deadline' | 'tags' | 'move' | 'help'

interface UIState {
  /** Selected to-do ids, in the order they appear in the list. */
  selectedIds: string[]
  /** Where a Shift-extended selection is anchored. */
  anchorId: string | null
  editingId: string | null
  /** A to-do created by the Add button that is discarded if left empty. */
  draftId: string | null
  /** Where "new to-do" puts things in the current list, if anywhere. */
  placement: Placement | null
  /** Which ordering the current list displays (Today has its own). */
  orderField: OrderField
  /** The project shown, so "new heading" knows where to go. */
  projectId: string | null
  panel: PanelKind | null
  /** What an open panel acts on, when not the editor or selection. */
  panelIds: string[] | null
  /** Mobile selection mode: taps toggle, a bar offers bulk actions. */
  selecting: boolean
  /** Quick Find: null when closed, else the text to start with. */
  finding: string | null
  /** Desktop Settings popover / mobile Settings sheet. */
  settingsOpen: boolean
  /** A to-do to select (desktop) or open (mobile) once its list shows. */
  pendingFocus: { todoId: string; path: string } | null
  /** Just-completed to-dos still shown: 'shown', then 'leaving' as they fold away. */
  lingering: Record<string, 'shown' | 'leaving'>
  /**
   * When a list windows its rows (Done), keyboard order comes from this
   * instead of querying the DOM for `[data-todo-id]`.
   */
  listTodoIds: string[] | null

  linger: (ids: string[]) => void
  stopLingering: (ids: string[]) => void
  select: (id: string | null) => void
  toggle: (id: string) => void
  extendTo: (id: string, visible: string[]) => void
  setSelection: (ids: string[]) => void
  edit: (id: string | null, opts?: { draft?: boolean }) => void
  setListContext: (ctx: {
    placement: Placement | null
    orderField: OrderField
    projectId?: string | null
  }) => void
  setListTodoIds: (ids: string[] | null) => void
  openPanel: (panel: PanelKind | null, ids?: string[]) => void
  startSelecting: (id: string) => void
  stopSelecting: () => void
  find: (query: string | null) => void
  setSettingsOpen: (open: boolean) => void
  focusAfterNavigation: (
    target: { todoId: string; path: string } | null,
  ) => void
}

/** How long a completed to-do stays visible, then how long it folds away. */
export const LINGER_MS = 1000
export const LEAVE_MS = 260

export const useUI = create<UIState>((set) => ({
  selectedIds: [],
  anchorId: null,
  editingId: null,
  draftId: null,
  placement: null,
  orderField: 'order',
  projectId: null,
  panel: null,
  panelIds: null,
  selecting: false,
  finding: null,
  settingsOpen: false,
  pendingFocus: null,
  lingering: {},
  listTodoIds: null,

  linger: (ids) => {
    if (!ids.length) return
    set((s) => ({
      lingering: {
        ...s.lingering,
        ...Object.fromEntries(ids.map((id) => [id, 'shown' as const])),
      },
    }))
    const mark = (state: 'leaving' | null) =>
      set((s) => {
        const next = { ...s.lingering }
        for (const id of ids) {
          if (!(id in next)) continue
          if (state) next[id] = state
          else delete next[id]
        }
        return { lingering: next }
      })
    setTimeout(() => mark('leaving'), LINGER_MS)
    setTimeout(() => mark(null), LINGER_MS + LEAVE_MS)
  },
  stopLingering: (ids) =>
    set((s) => {
      const next = { ...s.lingering }
      for (const id of ids) delete next[id]
      return { lingering: next }
    }),

  select: (id) => set({ selectedIds: id ? [id] : [], anchorId: id }),
  toggle: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
      anchorId: id,
    })),
  extendTo: (id, visible) =>
    set((s) => {
      const anchor =
        s.anchorId && visible.includes(s.anchorId) ? s.anchorId : id
      const [a, b] = [visible.indexOf(anchor), visible.indexOf(id)]
      if (b === -1) return {}
      return {
        selectedIds: visible.slice(Math.min(a, b), Math.max(a, b) + 1),
        anchorId: anchor,
      }
    }),
  setSelection: (ids) => set({ selectedIds: ids, anchorId: ids[0] ?? null }),
  edit: (id, opts) =>
    set((s) => ({
      editingId: id,
      selectedIds: id ? [id] : s.selectedIds,
      anchorId: id ?? s.anchorId,
      draftId: opts?.draft ? id : id === null ? null : s.draftId,
    })),
  setListContext: ({ placement, orderField, projectId = null }) =>
    set({ placement, orderField, projectId }),
  setListTodoIds: (listTodoIds) => set({ listTodoIds }),
  openPanel: (panel, ids) =>
    set({ panel, panelIds: panel ? (ids ?? null) : null }),
  startSelecting: (id) =>
    set({ selecting: true, selectedIds: [id], anchorId: id }),
  stopSelecting: () =>
    set({ selecting: false, selectedIds: [], anchorId: null }),
  find: (finding) => set({ finding }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  focusAfterNavigation: (pendingFocus) => set({ pendingFocus }),
}))

/** To-do ids in the order they're displayed in the main list. */
export function visibleTodoIds(): string[] {
  const override = useUI.getState().listTodoIds
  if (override) return override
  return Array.from(document.querySelectorAll<HTMLElement>('[data-todo-id]'))
    .map((el) => el.dataset.todoId ?? '')
    .filter((id, i, all) => id !== '' && all.indexOf(id) === i)
}

/**
 * What commands act on: a panel's own targets (e.g. a swiped row), else
 * the open to-do, else the selection.
 */
export function targetIds(): string[] {
  const s = useUI.getState()
  return s.panelIds ?? (s.editingId ? [s.editingId] : s.selectedIds)
}

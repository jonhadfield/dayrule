import { useIsDesktop } from '../../app/context'
import { useUI } from '../../app/ui-state'

/**
 * The selection bar shows in mobile selection mode, and on desktop when
 * more than one to-do is selected; the Add button gives way to it.
 */
export function useSelectionBarShown(): boolean {
  const isDesktop = useIsDesktop()
  return useUI(
    (s) =>
      s.selecting || (isDesktop && !s.editingId && s.selectedIds.length >= 2),
  )
}

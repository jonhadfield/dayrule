import { Dialog } from 'radix-ui'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { InSheet } from './sheet-context'

const DISMISS_PX = 80
const DISMISS_SPEED = 0.5 // px per ms

interface Props {
  /** Optional: a sheet can also be opened programmatically. */
  trigger?: ReactNode
  children: ReactNode
  /** Names the sheet for screen readers. */
  title: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** A bottom sheet (mobile): slides up, swipe the handle down to dismiss. */
export function Sheet({ trigger, children, title, open, onOpenChange }: Props) {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const setOpen = (v: boolean) => {
    if (open === undefined) setInner(v)
    onOpenChange?.(v)
  }
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null)

  // Swipe the handle down to dismiss; it follows the finger meanwhile.
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, t: e.timeStamp, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || !panel.current) return
    d.dy = Math.max(0, e.clientY - d.y)
    panel.current.style.transform = `translateY(${d.dy}px)`
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || !panel.current) return
    const speed = d.dy / Math.max(1, e.timeStamp - d.t)
    panel.current.style.transform = ''
    if (d.dy > DISMISS_PX || speed > DISMISS_SPEED) setOpen(false)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={setOpen}>
      {trigger !== undefined && (
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-text/25" />
        <Dialog.Content
          ref={panel}
          aria-describedby={undefined}
          // Focus the sheet itself, not its first field (see useInSheet).
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            panel.current?.focus()
          }}
          className="sheet fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[14px] border-t border-hairline bg-bg px-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-lg outline-none"
        >
          <div
            className="sticky top-0 -mx-3 flex touch-none justify-center bg-bg pt-2 pb-3"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <span className="h-1 w-10 rounded-full bg-hairline" aria-hidden />
          </div>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <InSheet.Provider value>{children}</InSheet.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

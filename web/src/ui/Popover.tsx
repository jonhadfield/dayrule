import { Dialog, Popover as P } from 'radix-ui'
import { useContext, type ReactNode } from 'react'
import { useIsDesktop } from '../app/context'
import { Sheet } from './Sheet'
import { InSheet } from './sheet-context'

interface Props {
  trigger: ReactNode
  children: ReactNode
  /** Names the sheet for screen readers on mobile. */
  title: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}

/**
 * A popover beside its trigger on desktop; a bottom sheet on mobile
 * (PLAN.md §6), which is easier to reach and to dismiss with a thumb.
 */
export function Popover({
  trigger,
  children,
  title,
  open,
  onOpenChange,
  align = 'start',
}: Props) {
  const isDesktop = useIsDesktop()
  if (!isDesktop) {
    return (
      <Sheet
        trigger={trigger}
        title={title}
        open={open}
        onOpenChange={onOpenChange}
      >
        {children}
      </Sheet>
    )
  }
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(280px,calc(100vw-24px))] rounded-[12px] border border-hairline bg-bg p-2 shadow-lg outline-none"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

/** Closes whichever is showing, the popover or the sheet. */
export function PopoverClose(props: {
  asChild?: boolean
  children: ReactNode
}) {
  const inSheet = useContext(InSheet)
  return inSheet ? <Dialog.Close {...props} /> : <P.Close {...props} />
}

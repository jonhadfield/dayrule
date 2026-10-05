import { Check, Minus } from 'lucide-react'
import type { Status } from '../domain/types'

interface Props {
  status: Status
  onToggle: () => void
  label: string
}

/** Round ink checkbox; canceled shows a dash (PLAN.md §5.2). */
export function Checkbox({ status, onToggle, label }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === 'completed'}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={[
        'grid size-[20px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors',
        status === 'completed'
          ? 'check-pop border-accent bg-accent text-bg'
          : status === 'canceled'
            ? 'border-text-secondary text-text-secondary'
            : 'border-text/50 hover:border-accent',
      ].join(' ')}
    >
      {status === 'completed' && (
        <Check size={13} strokeWidth={3} className="check-draw" />
      )}
      {status === 'canceled' && <Minus size={13} strokeWidth={3} />}
    </button>
  )
}

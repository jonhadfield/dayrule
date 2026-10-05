interface Props {
  done: number
  total: number
  completed?: boolean
  className?: string
}

/** Project progress as a slim ink bar (PLAN.md §5.2). */
export function Progress({
  done,
  total,
  completed = false,
  className = 'w-4',
}: Props) {
  const fraction = completed ? 1 : total === 0 ? 0 : done / total
  return (
    <span
      role="img"
      aria-label={`${done} of ${total} done`}
      className={`relative inline-block h-[5px] shrink-0 overflow-hidden rounded-full bg-hairline ${className}`}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-accent"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </span>
  )
}

import { useState, type ReactNode } from 'react'
import { useEntityStore, useToday } from '../../app/context'
import { formatDisplayDate } from '../../domain/dates'
import type { Repeat } from '../../domain/types'
import { setRepeat } from '../../store/repeats'
import { Calendar } from '../../ui/Calendar'
import { Popover } from '../../ui/Popover'

const FREQS: { value: Repeat['freq']; label: string; unit: string }[] = [
  { value: 'day', label: 'Daily', unit: 'days' },
  { value: 'week', label: 'Weekly', unit: 'weeks' },
  { value: 'month', label: 'Monthly', unit: 'months' },
  { value: 'year', label: 'Yearly', unit: 'years' },
]
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/**
 * Set how a to-do repeats (PLAN.md §4.2). `templateId` is the to-do itself
 * for a plain to-do or template, or an instance's template.
 */
export function RepeatPanel({
  templateId,
  current,
  defaultAnchor,
  onDone,
}: {
  templateId: string
  current?: Repeat
  defaultAnchor?: string
  onDone: () => void
}) {
  const store = useEntityStore()
  const today = useToday()
  const [freq, setFreq] = useState<Repeat['freq']>(current?.freq ?? 'week')
  const [every, setEvery] = useState(current?.every ?? 1)
  const [weekdays, setWeekdays] = useState<number[]>(current?.weekdays ?? [])
  const [mode, setMode] = useState<Repeat['mode']>(current?.mode ?? 'fixed')
  const [anchor, setAnchor] = useState(
    current?.anchor ?? defaultAnchor ?? today,
  )
  const [picking, setPicking] = useState(false)
  const unit = FREQS.find((f) => f.value === freq)!.unit

  const save = () => {
    const rule: Omit<Repeat, 'next'> = {
      freq,
      every: Math.max(1, Math.min(99, Math.round(every) || 1)),
      mode,
      anchor,
      ...(freq === 'week' && mode === 'fixed' && weekdays.length
        ? { weekdays: [...weekdays].sort() }
        : {}),
    }
    store.run('Repeat', (d, env) => setRepeat(d, env, templateId, rule))
    onDone()
  }
  const stop = () => {
    store.run('Stop Repeating', (d, env) => setRepeat(d, env, templateId, null))
    onDone()
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${on ? 'border-text bg-text text-bg' : 'border-hairline'}`

  return (
    <div className="flex flex-col gap-3 p-1 text-sm">
      <div
        className="flex flex-wrap gap-1"
        role="radiogroup"
        aria-label="How often"
      >
        {FREQS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={freq === f.value}
            className={chip(freq === f.value)}
            onClick={() => setFreq(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        Every
        <input
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          value={every}
          onChange={(e) => setEvery(Number(e.target.value))}
          className="w-16 rounded-[6px] border border-hairline bg-transparent px-2 py-1"
        />
        {every === 1 ? unit.slice(0, -1) : unit}
      </label>
      {freq === 'week' && mode === 'fixed' && (
        <div className="flex gap-1" role="group" aria-label="On these days">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={weekdays.includes(i)}
              className={`size-9 rounded-full border ${weekdays.includes(i) ? 'border-text bg-text text-bg' : 'border-hairline'}`}
              onClick={() =>
                setWeekdays((w) =>
                  w.includes(i) ? w.filter((x) => x !== i) : [...w, i],
                )
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Repeat</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === 'fixed'}
            onChange={() => setMode('fixed')}
          />
          On a schedule
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === 'afterCompletion'}
            onChange={() => setMode('afterCompletion')}
          />
          After I complete the last one
        </label>
      </fieldset>
      <div>
        <button
          type="button"
          className="text-accent"
          onClick={() => setPicking((p) => !p)}
        >
          Starting {formatDisplayDate(anchor)}
        </button>
        {picking && (
          <Calendar
            today={today}
            selected={anchor}
            onSelect={(d) => {
              setAnchor(d)
              setPicking(false)
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-text px-4 py-1.5 font-medium text-bg hover:bg-accent"
        >
          {current ? 'Save' : 'Repeat'}
        </button>
        {current && (
          <button
            type="button"
            onClick={stop}
            className="text-text-secondary hover:text-deadline"
          >
            Stop repeating
          </button>
        )}
      </div>
    </div>
  )
}

/** Repeat panel in a popover (a sheet on mobile), opened from a button. */
export function RepeatPicker({
  trigger,
  ...props
}: Omit<Parameters<typeof RepeatPanel>[0], 'onDone'> & { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      title="Repeat"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
    >
      <RepeatPanel {...props} onDone={() => setOpen(false)} />
    </Popover>
  )
}

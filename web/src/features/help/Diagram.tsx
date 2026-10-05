// Small SVG building blocks for the help diagrams. They use the colour
// tokens, so they follow light and dark mode, and each diagram carries a
// text description for screen readers.

import { createContext, useContext, useId, type ReactNode } from 'react'

export type Tone =
  | 'plain'
  | 'accent'
  | 'today'
  | 'scheduled'
  | 'ready'
  | 'later'
  | 'done'
  | 'muted'

const TONE: Record<Tone, { box: string; text: string }> = {
  plain: { box: 'fill-bg stroke-text', text: 'fill-text' },
  muted: { box: 'fill-sidebar stroke-hairline', text: 'fill-text-secondary' },
  accent: { box: 'fill-accent stroke-accent', text: 'fill-bg' },
  today: { box: 'fill-bg stroke-today', text: 'fill-today' },
  scheduled: { box: 'fill-bg stroke-scheduled', text: 'fill-scheduled' },
  ready: { box: 'fill-bg stroke-ready', text: 'fill-ready' },
  later: { box: 'fill-bg stroke-later', text: 'fill-later' },
  done: { box: 'fill-bg stroke-done', text: 'fill-done' },
}

/** A diagram: `description` is what a screen reader hears instead. */
export function Diagram({
  width,
  height,
  description,
  caption,
  children,
}: {
  width: number
  height: number
  description: string
  caption?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <figure className="my-6">
      {/* On a phone the diagram keeps a readable size and scrolls sideways. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-d`}
          className="h-auto w-full min-w-[540px] rounded-[10px] border border-hairline bg-sidebar/40"
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          <title id={`${id}-d`}>{description}</title>
          <defs>
            <marker
              id={`${id}-a`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="fill-text-secondary" />
            </marker>
          </defs>
          <ArrowId.Provider value={`${id}-a`}>{children}</ArrowId.Provider>
        </svg>
      </div>
      {caption && (
        <figcaption className="mt-2 text-sm text-text-secondary">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

const ArrowId = createContext('')

/** A labelled box, centred on (x, y). */
export function Box({
  x,
  y,
  w = 120,
  h = 44,
  label,
  sub,
  tone = 'plain',
  dashed = false,
}: {
  x: number
  y: number
  w?: number
  h?: number
  label: string
  sub?: string
  tone?: Tone
  dashed?: boolean
}) {
  const t = TONE[tone]
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={10}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '5 4' : undefined}
        className={t.box}
      />
      <text
        x={x}
        y={sub ? y - 4 : y + 5}
        textAnchor="middle"
        fontSize={14}
        fontWeight={600}
        className={t.text}
      >
        {label}
      </text>
      {sub && (
        <text
          x={x}
          y={y + 13}
          textAnchor="middle"
          fontSize={11}
          className={tone === 'accent' ? 'fill-bg' : 'fill-text-secondary'}
        >
          {sub}
        </text>
      )}
    </g>
  )
}

/** An arrow from (x1, y1) to (x2, y2), with an optional label at its middle. */
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  both = false,
  labelDy = -6,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  both?: boolean
  labelDy?: number
}) {
  const marker = `url(#${useContext(ArrowId)})`
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        strokeWidth={1.5}
        className="stroke-text-secondary"
        markerEnd={marker}
        markerStart={both ? marker : undefined}
      />
      {label && (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 + labelDy}
          textAnchor="middle"
          fontSize={11}
          className="fill-text-secondary"
        >
          {label}
        </text>
      )}
    </g>
  )
}

/** Plain text in a diagram. */
export function Label({
  x,
  y,
  children,
  size = 12,
  anchor = 'middle',
  strong = false,
}: {
  x: number
  y: number
  children: ReactNode
  size?: number
  anchor?: 'start' | 'middle' | 'end'
  strong?: boolean
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fontWeight={strong ? 600 : 400}
      className={strong ? 'fill-text' : 'fill-text-secondary'}
    >
      {children}
    </text>
  )
}

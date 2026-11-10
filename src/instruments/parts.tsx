// The small things the three readings are drawn with: a section and its count, the line an
// empty list leaves, a bar, a list that keeps its tail behind a count, and a link that opens
// outside the app.

import { createContext, useContext, useState, type ReactNode } from 'react'
import { splitPath } from './read'

/** A titled part of a reading. `count` is said beside the title; `note` explains the columns. */
export function Section({ title, count, note, children }: { title: string; count?: ReactNode; note?: string; children: ReactNode }) {
  return (
    <section className="instruments-sec" data-sec={title}>
      <h3 className="instruments-sec-h">
        <span>{title}</span>
        {count != null && <b className="mn-num">{count}</b>}
        {note && <small>{note}</small>}
      </h3>
      {children}
    </section>
  )
}

/** What a reading says where it has nothing to list. */
export function None({ children }: { children: ReactNode }) {
  return <p className="instruments-none">{children}</p>
}

/** A hairline bar filled to `value` (0 to 1). */
export function Bar({ value, tone }: { value: number; tone?: 'memory' | 'lit' }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  return (
    <span className="instruments-bar" data-tone={tone}>
      <i style={{ transform: `scaleX(${v.toFixed(4)})` }} />
    </span>
  )
}

/** A list that shows its first `cap` and keeps the rest one press away, never out of reach. */
export function Capped<T>({ items, cap, children, what = 'more' }: { items: T[]; cap: number; children: (item: T, index: number) => ReactNode; what?: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, cap)
  return (
    <>
      {shown.map(children)}
      {items.length > cap && (
        <button type="button" className="instruments-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'show fewer' : `and ${items.length - cap} ${what}`}
        </button>
      )}
    </>
  )
}

/** Opens a link or a file outside the app; what came of it is said by the instruments. */
export const OpenContext = createContext<(target: string) => void>(() => {})

/** A link or a file: opened outside the app through `actions().external`, never navigated to. */
export function Out({ to, className, children, label }: { to: string; className?: string; children: ReactNode; label?: string }) {
  const open = useContext(OpenContext)
  return (
    <button type="button" className={`instruments-out ${className ?? ''}`} data-out={to} aria-label={label} onClick={() => open(to)}>
      {children}
    </button>
  )
}

/** A path: its folders quiet, its file bright. */
export function Path({ path }: { path: string }) {
  const { dir, base } = splitPath(path)
  return (
    <span className="instruments-path mn-mono">
      <span className="instruments-path-dir">{dir}</span>
      <span className="instruments-path-base">{base}</span>
    </span>
  )
}

/** What a judge scored a rule: a bar and the number, or the mark of a rule nobody judged. */
export function Judge({ value, tone }: { value: number | null; tone?: 'memory' }) {
  if (value == null) return <span className="instruments-judge" data-none aria-label="not judged" />
  return (
    <>
      <span className="instruments-judge" aria-hidden="true">
        <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value)).toFixed(2)})` }} data-tone={tone} />
      </span>
      <b className="instruments-judge-n mn-num" aria-label={`judge ${value.toFixed(2)}`}>
        {value.toFixed(2).replace(/^0/, '')}
      </b>
    </>
  )
}

/** A retrieval score to two places. */
export const score = (n: number | null): string => (n == null ? '–' : n.toFixed(2))

/** "1 compaction", "3 compactions". */
export const plural = (n: number, one: string, many = one + 's'): string => `${n === 1 ? one : many}`

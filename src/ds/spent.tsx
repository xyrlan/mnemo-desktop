// "Spent by kind": what a session's tokens went on, as one bar split four ways and as rows
// (label, bar, number). The row is the same one for anything measured against a whole: a
// kind of token, a sub-agent, a session in its tree, a model, a plan's window.

import type { ReactNode } from 'react'
import { sum, tokens } from '../world/format'
import type { TokenRow } from '../world/types'
import { Full } from './full'

export type SpentKind = 'input' | 'output' | 'cacheRead' | 'cacheCreation'

export interface SpentPart {
  kind: SpentKind
  label: string
  value: number
  /** Its part of everything the row counted, 0 to 1. */
  share: number
  /** What is worth saying under it: how much of the output was thinking. */
  note: string | null
}

const KINDS: [SpentKind, string][] = [
  ['input', 'input'],
  ['output', 'output'],
  ['cacheRead', 'cache read'],
  ['cacheCreation', 'cache written'],
]

/** A token row as its four kinds, always in the same order. Thinking is part of the output,
 *  so it is said under it and never added again. */
export function spentKinds(row: TokenRow | null | undefined): SpentPart[] {
  const total = sum(row)
  return KINDS.map(([kind, label]) => {
    const value = Math.max(0, row?.[kind] ?? 0)
    return { kind, label, value, share: total > 0 ? value / total : 0, note: kind === 'output' && row && row.thinking > 0 ? `${tokens(row.thinking)} of it thinking` : null }
  })
}

/** How much of a bar `value` fills against `of`: a value that is not zero always shows. */
export function fill(value: number, of: number): number {
  if (!(value > 0) || !(of > 0)) return 0
  return Math.max(0.004, Math.min(1, value / of))
}

/** One bar, split by kind in proportion. A kind that spent anything keeps a hairline. */
export function SpentBar({ tokens: row, className }: { tokens: TokenRow | null | undefined; className?: string }) {
  const parts = spentKinds(row)
  const total = sum(row)
  return (
    <span className={`mn-spent-bar ${className ?? ''}`} data-empty={total > 0 ? undefined : 'true'} role="img" aria-label={parts.map((p) => `${p.label} ${tokens(p.value)}`).join(', ')}>
      {parts.map((p) => (p.value > 0 ? <i key={p.kind} data-kind={p.kind} style={{ flexGrow: p.value }} /> : null))}
    </span>
  )
}

/** A row: what it is, how much of the whole it is, and the number.
 *  `value` against `of` fills the bar; `text` is the number as it should read (tokens by
 *  default). `kind` puts the bar's own swatch before the label; `lead` puts anything else
 *  there (a state mark). `onClick` makes the row a button. */
export function SpentRow({ label, value, of, text, note, kind, lead, selected, off, onClick }: {
  label: string
  value: number
  of: number
  text?: string
  note?: ReactNode
  kind?: SpentKind
  lead?: ReactNode
  selected?: boolean
  off?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="mn-row-label">
        {kind && <i className="mn-row-swatch" data-kind={kind} aria-hidden="true" />}
        {lead}
        {/* a row that is a button goes somewhere when pressed, so its label only cuts */}
        {onClick ? <span className="mn-row-text">{label}</span> : <Full value={label} />}
      </span>
      <span className="mn-bar">
        <i style={{ transform: `scaleX(${fill(value, of).toFixed(4)})` }} />
      </span>
      <b className="mn-num">{text ?? tokens(value)}</b>
      {note && <small>{note}</small>}
    </>
  )
  const props = { className: 'mn-row', 'data-selected': selected ? 'true' : undefined, 'data-off': off ? 'true' : undefined }
  return onClick ? (
    <button type="button" {...props} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div {...props}>{body}</div>
  )
}

/** The bar and its four rows. Each row's bar is measured against the largest kind, so the
 *  small ones can still be told apart. */
export function SpentByKind({ tokens: row }: { tokens: TokenRow | null | undefined }) {
  const parts = spentKinds(row)
  const most = Math.max(...parts.map((p) => p.value))
  return (
    <div className="mn-spent">
      <SpentBar tokens={row} />
      {parts.map((p) => (
        <SpentRow key={p.kind} kind={p.kind} label={p.label} value={p.value} of={most} note={p.note} />
      ))}
    </div>
  )
}

// The design system's primitives: what every view draws with, so three views read as one
// app (docs/superpowers/specs/2026-11-10-recreation-design.md, "Identity"). Tokens are in
// tokens.css and the primitives' styles in primitives.css, both scoped to the frame's `.mn`
// root. Every primitive in every state is on the gallery page (Gallery.tsx; the preview
// scenarios `next-ds*`).

import { Children, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { WORD } from '../world/format'
import type { SessionState } from '../world/types'
import { constellation, FIGURE_BOX } from './figure'
import { createLattice, type LatticeHandle } from './lattice'
import './primitives.css'

export { constellation, figureDistance, type Constellation } from './figure'
export { ContextCurve, compactionNote, curveOf, type Cliff, type Curve } from './curve'
export { SpentBar, SpentByKind, SpentRow, spentKinds, type SpentKind, type SpentPart } from './spent'
export { Full } from './full'

/** Nearly full: from here a meter, a ring or a number is `hot`. */
export const HOT = 0.8

const unit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)
const length = (size: number | string) => (typeof size === 'number' ? `${size}px` : size)

// A state is a shape first, so it survives a grey screen: the six, drawn (the prototypes'
// marks) instead of typed, so they are the same on every machine and font.
const SHAPE: Record<SessionState, ReactNode> = {
  need: <path d="M0-6.6 6.6 0 0 6.6-6.6 0Z" />,
  working: (
    <>
      <circle r={4.2} />
      <circle className="mn-state-echo" r={4.2} />
    </>
  ),
  ready: <path d="M0-6 6.6 5.2H-6.6Z" />,
  stalled: <path className="mn-state-stroke" d="M-5-5 5 5M5-5-5 5" />,
  idle: <circle className="mn-state-stroke" r={4.6} />,
  ended: <circle r={2} />,
}

/** A session's state as a shape, and its word when asked. Never colour alone. */
export function StateMark({ state, word = false, className }: { state: SessionState; word?: boolean; className?: string }) {
  return (
    <span className={`mn-state ${className ?? ''}`} data-state={state}>
      <i className="mn-state-glyph" aria-hidden="true">
        <svg viewBox="-8 -8 16 16">{SHAPE[state]}</svg>
      </i>
      {word ? <span className="mn-state-word">{WORD[state]}</span> : <span className="mn-sr">{WORD[state]}</span>}
    </span>
  )
}

/** A key the maintainer can press. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mn-kbd">{children}</kbd>
}

/** A small uppercase label over a section or a number. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`mn-label ${className ?? ''}`}>{children}</span>
}

/** Words that stand side by side as one run of text. `{n} wait for you` reaches a component as
 *  two strings; laid out as two boxes they lose the space between them and can be cut. */
function oneRun(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  for (const child of Children.toArray(children)) {
    const last = out[out.length - 1]
    const words = typeof child === 'string' || typeof child === 'number'
    if (words && (typeof last === 'string' || typeof last === 'number')) out[out.length - 1] = `${last}${child}`
    else out.push(child)
  }
  return out
}

/** A pill: a tag, or a button when it has `onClick`. */
export function Pill({ children, active, tone, onClick, title }: { children: ReactNode; active?: boolean; tone?: 'need' | 'memory'; onClick?: () => void; title?: string }) {
  const props = { className: 'mn-pill', 'data-active': active ? 'true' : undefined, 'data-tone': tone, title }
  return onClick ? (
    <button type="button" {...props} onClick={onClick} aria-pressed={active === undefined ? undefined : active}>
      {oneRun(children)}
    </button>
  ) : (
    <span {...props}>{oneRun(children)}</span>
  )
}

/** A thin bar filled to `value` (0 to 1). `hot` when it is nearly full. `ticks` rules it in
 *  tenths (the roster's context gauge). `label` says what it measures to a screen reader. */
export function Meter({ value, width = '6em', hot, ticks, label }: { value: number; width?: string; hot?: boolean; ticks?: boolean; label?: string }) {
  const v = unit(value)
  return (
    <span className="mn-meter" style={{ width }} data-tone={hot ? 'hot' : undefined} data-ticks={ticks ? 'true' : undefined} role="meter" aria-label={label} aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ transform: `scaleX(${v.toFixed(4)})` }} />
    </span>
  )
}

const TICKS = 40

/** A ring filled to `value` (0 to 1), with whatever stands in its middle. `size` is pixels,
 *  or any CSS length (`'7em'`, so it follows the frame's root size); `stroke` is pixels.
 *  `hot` when it is nearly full; `ticks` draws a dial round it (the stage's context ring). */
export function Ring({ value, size, stroke = 2, hot, ticks, className, children }: { value: number; size: number | string; stroke?: number; hot?: boolean; ticks?: boolean; className?: string; children?: ReactNode }) {
  const v = unit(value)
  const style = { width: length(size), height: length(size), '--mn-ring-stroke': `${stroke}px` } as CSSProperties
  return (
    <span className={`mn-ring ${className ?? ''}`} style={style} data-tone={hot ? 'hot' : undefined} data-ticks={ticks ? 'true' : undefined}>
      <svg className="mn-ring-dial" aria-hidden="true">
        {ticks &&
          Array.from({ length: TICKS }, (_, i) => {
            const a = (i / TICKS) * Math.PI * 2
            const from = i % 10 === 0 ? 44 : 46.5
            const at = (r: number) => ({ x: `${(50 + Math.cos(a) * r).toFixed(2)}%`, y: `${(50 + Math.sin(a) * r).toFixed(2)}%` })
            return <line key={i} className="tick" x1={at(from).x} y1={at(from).y} x2={at(49.5).x} y2={at(49.5).y} />
          })}
        <circle className="track" cx="50%" cy="50%" r="46%" />
        <circle className="fill" cx="50%" cy="50%" r="46%" pathLength={1} strokeDasharray="1 1" strokeDashoffset={(1 - v).toFixed(4)} />
      </svg>
      {children}
    </span>
  )
}

/** A session's figure: a small constellation worked out from its id, the same wherever the
 *  session appears, so it is recognised before its name is read. `size` is pixels or any CSS
 *  length. */
export function Figure({ id, size = 32, className }: { id: string; size?: number | string; className?: string }) {
  const { points, lines } = useMemo(() => constellation(id), [id])
  return (
    <svg className={`mn-figure ${className ?? ''}`} viewBox={`0 0 ${FIGURE_BOX} ${FIGURE_BOX}`} width={size} height={size} style={{ width: length(size), height: length(size) }} data-asset="session-figure" aria-hidden="true">
      <circle className="mn-figure-ring" cx={FIGURE_BOX / 2} cy={FIGURE_BOX / 2} r={FIGURE_BOX / 2 - 0.6} />
      {lines.map(([a, b], i) => (
        <line key={i} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} vectorEffect="non-scaling-stroke" />
      ))}
      {points.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </svg>
  )
}

// The crystal's shells, outermost first: half its width and half its height, in the mark's
// 32-unit box. Measured off the generated still (art/crystal-still.jpg).
const SHELLS: [number, number][] = [
  [7.8, 14],
  [4.4, 8],
  [3.1, 4.2],
  [1.2, 1.7],
]

/** The mark: the nested memory crystal, in hairlines. The app's own sign, at any size.
 *  `detail` is how much of the crystal is drawn: 1 for an icon (two shells), 2 for a header
 *  (three, with the facets between the outer two), 3 for the whole crystal with its nodes. By
 *  default it follows `size`. */
export function Mark({ size = 24, detail, className }: { size?: number | string; detail?: 1 | 2 | 3; className?: string }) {
  const level = detail ?? (typeof size !== 'number' ? 2 : size < 22 ? 1 : size < 72 ? 2 : 3)
  const shells = SHELLS.slice(0, level + 1)
  const rhomb = ([w, h]: [number, number]) => `M16 ${16 - h}L${16 + w} 16L16 ${16 + h}L${16 - w} 16Z`
  // a facet: the edges from a shell's side corners to the next shell's top and bottom, and
  // from its top and bottom to the next one's sides
  const facet = ([w, h]: [number, number], [iw, ih]: [number, number]) =>
    `M${16 - w} 16L16 ${16 - ih}L${16 + w} 16L16 ${16 + ih}Z M16 ${16 - h}L${16 - iw} 16L16 ${16 + h}L${16 + iw} 16Z`
  const [w, h] = SHELLS[0]
  return (
    <svg className={`mn-mark ${className ?? ''}`} viewBox="0 0 32 32" width={size} height={size} style={{ width: length(size), height: length(size) }} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" data-detail={level} data-asset="mark" aria-hidden="true">
      <path d={`M16 ${16 - h}V${16 + h}M${16 - w} 16H${16 + w}`} vectorEffect="non-scaling-stroke" opacity={0.4} />
      {level > 1 && shells.slice(0, -1).map((s, i) => <path key={`f${i}`} d={facet(s, shells[i + 1])} vectorEffect="non-scaling-stroke" opacity={i === 0 ? 0.5 : 0.4} />)}
      {shells.map((s, i) => (
        <path key={i} d={rhomb(s)} vectorEffect="non-scaling-stroke" opacity={i === 0 ? 1 : 0.8} />
      ))}
      {level > 2 &&
        shells.flatMap(([sw, sh], i) =>
          [
            [16, 16 - sh],
            [16 + sw, 16],
            [16, 16 + sh],
            [16 - sw, 16],
          ].map(([x, y], k) => <circle key={`n${i}${k}`} cx={x} cy={y} r={0.18} fill="currentColor" stroke="none" />),
        )}
    </svg>
  )
}

/** The centre piece. `pulse` changes each time a node should light: its value picks the node. */
export function Lattice({ pulse, onReady, className, style }: { pulse?: number; onReady?: (handle: LatticeHandle) => void; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const handle = useRef<LatticeHandle | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const made = createLattice(ref.current)
    handle.current = made
    onReady?.(made)
    return () => {
      made.dispose()
      handle.current = null
    }
    // The canvas is made once; `onReady` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (pulse !== undefined) handle.current?.pulse(pulse)
  }, [pulse])
  return <canvas ref={ref} className={`mn-lattice ${className ?? ''}`} style={style} data-asset="lattice" aria-hidden="true" />
}

/** The sparse field of stars behind everything: drawn once, never animated. */
export function Starfield({ count = 140 }: { count?: number }) {
  const stars = useMemo(() => {
    let h = 0x9e3779b9
    const next = () => {
      h ^= h << 13
      h ^= h >>> 17
      h ^= h << 5
      return (h >>> 0) / 4294967296
    }
    return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({ x: next() * 100, y: next() * 100, r: 0.4 + next() * 0.9, o: 0.15 + next() * 0.6 }))
  }, [count])
  return (
    <svg className="mn-stars" width="100%" height="100%" aria-hidden="true">
      {stars.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} />
      ))}
    </svg>
  )
}

/** The line that stands where a list has nothing: what is not there, in a sentence. */
export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`mn-empty ${className ?? ''}`}>{children}</p>
}

export type { LatticeHandle }

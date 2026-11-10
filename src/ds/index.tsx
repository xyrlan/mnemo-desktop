// The design system's primitives: what every view draws with, so three views read as one
// app (docs/superpowers/specs/2026-11-10-recreation-design.md, "Identity"). Styles are in
// tokens.css, scoped to the frame's `.mn` root.

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { GLYPH, WORD } from '../world/format'
import type { SessionState } from '../world/types'
import { createLattice, type LatticeHandle } from './lattice'

/** A session's state as a shape, and its word when asked. Never colour alone. */
export function StateMark({ state, word = false, className }: { state: SessionState; word?: boolean; className?: string }) {
  return (
    <span className={`mn-state ${className ?? ''}`} data-state={state} title={WORD[state]}>
      <i className="mn-state-glyph" aria-hidden="true">
        {GLYPH[state]}
      </i>
      {word ? <span className="mn-state-word">{WORD[state]}</span> : <span className="sr-only">{WORD[state]}</span>}
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

/** A pill: a tag, or a button when it has `onClick`. */
export function Pill({ children, active, tone, onClick, title }: { children: ReactNode; active?: boolean; tone?: 'need' | 'memory'; onClick?: () => void; title?: string }) {
  const props = { className: 'mn-pill', 'data-active': active ? 'true' : undefined, 'data-tone': tone, title }
  return onClick ? (
    <button type="button" {...props} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span {...props}>{children}</span>
  )
}

/** A thin bar filled to `value` (0 to 1). `hot` when it is nearly full. */
export function Meter({ value, width = '6em', hot }: { value: number; width?: string; hot?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className="mn-meter" style={{ width }} data-tone={hot ? 'hot' : undefined} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}

/** A ring filled to `value` (0 to 1), with whatever stands in its middle. */
export function Ring({ value, size, stroke = 2, children }: { value: number; size: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const around = 2 * Math.PI * r
  return (
    <span className="mn-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={around} strokeDashoffset={around * (1 - Math.max(0, Math.min(1, value)))} />
      </svg>
      {children}
    </span>
  )
}

/** A session's figure: a small constellation worked out from its id, the same wherever the
 *  session appears, so it is recognised before its name is read. */
export function Figure({ id, size = 32, className }: { id: string; size?: number; className?: string }) {
  const { points, lines } = useMemo(() => constellation(id), [id])
  return (
    <svg className={`mn-figure ${className ?? ''}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      {lines.map(([a, b], i) => (
        <line key={i} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} vectorEffect="non-scaling-stroke" />
      ))}
      {points.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </svg>
  )
}

/** Four to six stars and the lines between them, from a string. Pure: the same id draws the
 *  same figure on every machine. */
export function constellation(id: string): { points: [number, number, number][]; lines: [number, number][] } {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const next = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return (h >>> 0) / 4294967296
  }
  const n = 4 + Math.floor(next() * 3)
  const points: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    // one star per sector, so the figure fills its square instead of clumping
    const a = ((i + next() * 0.7) / n) * Math.PI * 2
    const d = 6 + next() * 8
    points.push([16 + Math.cos(a) * d, 16 + Math.sin(a) * d, i === 0 ? 1.9 : 0.9 + next() * 0.8])
  }
  const lines: [number, number][] = []
  for (let i = 1; i < n; i++) lines.push([i - 1, i])
  if (next() > 0.5) lines.push([n - 1, Math.floor(next() * (n - 2))])
  return { points, lines }
}

/** The mark: the nested memory crystal, in hairlines. The app's own sign, at any size. */
export function Mark({ size = 24, className }: { size?: number; className?: string }) {
  const shell = (w: number, h: number) => `M16 ${16 - h} L${16 + w} 16 L16 ${16 + h} L${16 - w} 16 Z`
  return (
    <svg className={`mn-mark ${className ?? ''}`} viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true">
      <path d={shell(9, 14)} vectorEffect="non-scaling-stroke" />
      <path d={shell(5.5, 8.5)} vectorEffect="non-scaling-stroke" opacity={0.75} />
      <path d={shell(2.5, 4)} vectorEffect="non-scaling-stroke" opacity={0.55} />
      <path d="M16 2 V30 M7 16 H25" vectorEffect="non-scaling-stroke" opacity={0.35} />
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
    return Array.from({ length: count }, () => ({ x: next() * 100, y: next() * 100, r: 0.4 + next() * 0.9, o: 0.15 + next() * 0.6 }))
  }, [count])
  return (
    <svg className="mn-stars" width="100%" height="100%" aria-hidden="true">
      {stars.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} />
      ))}
    </svg>
  )
}

export type { LatticeHandle }

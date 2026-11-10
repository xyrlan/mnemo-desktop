// The context curve: how full a session's context window was over time, with a cliff where
// Claude Code compacted it. `curveOf` is the geometry, for a view that draws on a canvas
// (Score's lines); `ContextCurve` is the same curve as the Console prototype's chart.

import { useId, useState, type CSSProperties } from 'react'
import { age, tokens } from '../world/format'
import type { Context } from '../world/types'

export interface Cliff {
  /** 0 to 1 along the curve's time. */
  x: number
  /** 0 (empty) to 1 (the top of the plot), before and after. */
  from: number
  to: number
  at: number
  pre: number
  post: number
  trigger: string | null
  /** It had not happened yet at the moment asked for. */
  later: boolean
}

export interface Curve {
  /** `[x, y]`, both 0 to 1, y up; a cliff is two points at the same x. Empty when the series
   *  is too short to draw. */
  points: [number, number][]
  cliffs: Cliff[]
  /** The plot's time span and its top in tokens (the window, or the peak when that is higher). */
  from: number
  to: number
  top: number
  /** Where the window's edge is on y, 0 to 1 (1 unless a peak passed it). */
  window: number
  /** The last point at or before the moment asked for: where "now" is on the curve. */
  now: { x: number; y: number; tokens: number } | null
  /** How far along x the moment asked for is: 1 when it is now. */
  cut: number
}

/** The curve of `context`, as of `at` (null is now: the whole series). */
export function curveOf(context: Context, at: number | null = null): Curve {
  const series = context.series.filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v)).sort((a, b) => a[0] - b[0])
  const peak = Math.max(0, ...series.map((p) => p[1]), ...context.compactions.map((k) => k.pre))
  const top = Math.max(context.window || 0, peak, 1)
  if (series.length < 2) return { points: [], cliffs: [], from: series[0]?.[0] ?? 0, to: series[0]?.[0] ?? 0, top, window: (context.window || 0) / top, now: null, cut: 1 }
  const from = series[0][0]
  const to = Math.max(series[series.length - 1][0], from + 1)
  const x = (t: number) => (t - from) / (to - from)
  const y = (v: number) => Math.max(0, v) / top

  // A compaction is a cliff: the fall is drawn straight down at its moment, whatever the
  // thinned series kept on either side of it.
  const falls = context.compactions.filter((k) => k.at >= from && k.at <= to).sort((a, b) => a.at - b.at)
  const points: [number, number][] = []
  let f = 0
  for (const [t, v] of series) {
    let foot = false
    while (f < falls.length && falls[f].at <= t) {
      const k = falls[f++]
      points.push([x(k.at), y(k.pre)], [x(k.at), y(k.post)])
      // a sample taken at the cliff's own moment is its foot, already drawn
      if (k.at === t) foot = true
    }
    if (!foot) points.push([x(t), y(v)])
  }

  const moment = at == null ? to : Math.max(from, Math.min(to, at))
  let now: Curve['now'] = null
  for (const [t, v] of series) if (t <= moment) now = { x: x(t), y: y(v), tokens: v }
  return {
    points,
    cliffs: falls.map((k) => ({ x: x(k.at), from: y(k.pre), to: y(k.post), at: k.at, pre: k.pre, post: k.post, trigger: k.trigger, later: k.at > moment })),
    from,
    to,
    top,
    window: (context.window || 0) / top,
    now,
    cut: x(moment),
  }
}

/** The cliff a curve names when none was picked: the last one that had happened. */
export function namedCliff(curve: Curve, picked: number | null = null): Cliff | null {
  return curve.cliffs.find((k) => k.at === picked) ?? [...curve.cliffs].reverse().find((k) => !k.later) ?? null
}

/** What the compactions come to, in a sentence: the line under the curve. */
export function compactionNote(context: Context, now: number): string {
  const all = [...context.compactions].sort((a, b) => a.at - b.at)
  if (!all.length) return 'Never compacted.'
  const last = all[all.length - 1]
  return `${all.length} ${all.length === 1 ? 'compaction' : 'compactions'}. The last, ${age(last.at, now)} ago, took ${tokens(last.pre)} down to ${tokens(last.post)}${last.trigger ? ` (${last.trigger})` : ''}.`
}

const W = 1000
const H = 300

/** The curve, drawn. `now` is the world's clock (for the ages on the axis); `at` is the moment
 *  to show the session as of, with what came later dimmed. One cliff at a time is named over
 *  the plot (what it took down to what, and when): the last, until another's mark is picked.
 *  No hover is involved, and two names never meet. */
export function ContextCurve({ context, now, at = null, className, style }: { context: Context; now: number; at?: number | null; className?: string; style?: CSSProperties }) {
  const curve = curveOf(context, at)
  const clip = `mn-curve-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [picked, setPicked] = useState<number | null>(null)
  const named = namedCliff(curve, picked)
  if (!curve.points.length) {
    return (
      <div className={`mn-curve ${className ?? ''}`} data-empty="true" style={style}>
        <p className="mn-empty">Too few calls to draw a curve.</p>
      </div>
    )
  }
  const px = (p: [number, number]) => `${(p[0] * W).toFixed(1)} ${(H - p[1] * H).toFixed(1)}`
  const d = curve.points.map((p, i) => (i ? 'L' : 'M') + px(p)).join('')
  const cut = curve.cut * W
  const replay = curve.cut < 1
  return (
    <div className={`mn-curve ${className ?? ''}`} data-replay={replay || undefined} data-cliffs={curve.cliffs.length || undefined} style={style}>
      {curve.cliffs.length > 0 && (
        <div className="mn-curve-named" aria-live="polite">
          {named && (
            <span className="mn-curve-fall mn-num" data-later={named.later || undefined} data-side={named.x > 0.5 ? 'left' : undefined} style={named.x > 0.5 ? { right: `${((1 - named.x) * 100).toFixed(2)}%` } : { left: `${(named.x * 100).toFixed(2)}%` }}>
              {tokens(named.pre)} → {tokens(named.post)}
              <small>
                {named.trigger ? `${named.trigger} · ` : ''}
                {age(named.at, now)} ago
              </small>
            </span>
          )}
        </div>
      )}
      <div className="mn-curve-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={-10} width={cut} height={H + 20} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} className="mn-curve-grid" x1={0} x2={W} y1={H * g} y2={H * g} />
          ))}
          {curve.window < 1 && <line className="mn-curve-window" x1={0} x2={W} y1={H - curve.window * H} y2={H - curve.window * H} />}
          {replay && <path className="mn-curve-later" d={d} />}
          <g clipPath={`url(#${clip})`}>
            <path className="mn-curve-area" d={`${d}L${W} ${H}L0 ${H}Z`} />
            <path className="mn-curve-line" d={d} />
          </g>
          {curve.cliffs.map((k) => (
            <line key={k.at} className="mn-curve-cliff" data-later={k.later || undefined} x1={k.x * W} x2={k.x * W} y1={0} y2={H} />
          ))}
          {replay && <line className="mn-curve-at" x1={cut} x2={cut} y1={0} y2={H} />}
        </svg>
        {curve.cliffs.map((k) =>
          curve.cliffs.length > 1 ? (
            <button key={k.at} type="button" className="mn-curve-mark" data-later={k.later || undefined} data-named={k === named || undefined} aria-pressed={k === named} aria-label={`compaction ${age(k.at, now)} ago`} style={{ left: `${(k.x * 100).toFixed(2)}%` }} onClick={() => setPicked(k.at)} />
          ) : (
            <i key={k.at} className="mn-curve-mark" data-later={k.later || undefined} data-named={k === named || undefined} style={{ left: `${(k.x * 100).toFixed(2)}%` }} />
          ),
        )}
        <span className="mn-curve-top mn-num">{tokens(curve.top)}</span>
        {curve.now && <i className="mn-curve-now" style={{ left: `${(curve.now.x * 100).toFixed(2)}%`, top: `${((1 - curve.now.y) * 100).toFixed(2)}%` }} />}
      </div>
      <div className="mn-curve-axis">
        <span>{age(curve.from, now)} ago</span>
        <span>{now - curve.to < 60_000 ? 'now' : `${age(curve.to, now)} ago`}</span>
      </div>
    </div>
  )
}

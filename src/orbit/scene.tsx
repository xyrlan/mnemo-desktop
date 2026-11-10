// What the scene is drawn with: the line art, a body with its moons, a label. Everything
// that moves at rest is a CSS animation of `transform` or `opacity` on an HTML element; the
// SVG is static line art.

import { memo, type CSSProperties } from 'react'
import { Figure } from '../ds'
import { GLYPH, WORD, age, tokens } from '../world/format'
import { sessionOf } from '../world/store'
import type { Pending, Session, SessionState, World } from '../world/types'
import type { Chart, Geom, Placed } from './layout'
import { BAND, KIND_GLYPH, KIND_STATE, KIND_WORD, doing, familyCounts, type Body } from './model'

const n = (v: number) => v.toFixed(2)
const vars = (o: Record<string, string | number>) => o as CSSProperties

/** A state is a shape first: ◆ needs you, ● working, ▲ ready, ✕ stalled, ○ your turn, a
 *  dotted ghost for ended. */
export function Glyph({ state, r }: { state: SessionState; r: number }) {
  switch (state) {
    case 'need':
      return <path className="orbit-g-core" d={`M0 ${n(-r * 1.2)}L${n(r * 1.2)} 0L0 ${n(r * 1.2)}L${n(-r * 1.2)} 0Z`} />
    case 'working':
      return <circle className="orbit-g-core" r={n(r)} />
    case 'ready':
      return <path className="orbit-g-core" d={`M0 ${n(-r * 1.15)}L${n(r * 1.08)} ${n(r * 0.78)}L${n(-r * 1.08)} ${n(r * 0.78)}Z`} />
    case 'stalled':
      return <path className="orbit-g-x" d={`M${n(-r * 0.8)} ${n(-r * 0.8)}L${n(r * 0.8)} ${n(r * 0.8)}M${n(r * 0.8)} ${n(-r * 0.8)}L${n(-r * 0.8)} ${n(r * 0.8)}`} strokeWidth={n(Math.max(1.6, r * 0.28))} />
    case 'idle':
      return <circle className="orbit-g-hollow" r={n(r)} />
    default:
      return (
        <>
          <circle className="orbit-g-ghost" r={n(r)} />
          <circle className="orbit-g-dot" r={n(Math.max(1.2, r * 0.22))} />
        </>
      )
  }
}

/** The bands, the rim, the sectors and their names. */
export const ChartArt = memo(function ChartArt({ g, chart }: { g: Geom; chart: Chart }) {
  return (
    <svg className="orbit-chart" width={g.W} height={g.H} viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden="true">
      <defs>
        <radialGradient id="orbit-need-light">
          <stop offset="52%" stopColor="#ffb020" stopOpacity="0" />
          <stop offset="78%" stopColor="#ffb020" stopOpacity="0.075" />
          <stop offset="100%" stopColor="#ffb020" stopOpacity="0" />
        </radialGradient>
        {chart.bands.map((b) => (
          <path key={b.id} id={`orbit-band-${b.id}`} d={b.arc} />
        ))}
        {chart.sectors.map((s, i) => (
          <path key={s.name} id={`orbit-sector-${i}`} d={s.arc} />
        ))}
      </defs>
      {chart.bands[0].hot && <ellipse data-asset="need-band-light" cx={g.cx} cy={g.cy} rx={g.rx * BAND.need.hi} ry={g.ry * BAND.need.hi} fill="url(#orbit-need-light)" />}
      {chart.bands.map((b) => (
        <ellipse key={b.id} className="orbit-ring" data-hot={b.hot || undefined} cx={g.cx} cy={g.cy} rx={b.rx} ry={b.ry} />
      ))}
      <ellipse className="orbit-rim" cx={g.cx} cy={g.cy} rx={g.rx} ry={g.ry} />
      <path className="orbit-ticks" d={chart.ticks} />
      {chart.bands.map((b) => (
        <text key={b.id} className="orbit-band-name" data-hot={b.hot || undefined} data-band={b.id} fontSize={b.size.toFixed(1)}>
          <textPath href={`#orbit-band-${b.id}`} startOffset="50%" textAnchor="middle">
            {b.name}
          </textPath>
        </text>
      ))}
      {chart.sectors.map((s, i) => (
        <g key={s.name} data-sector={s.name}>
          {s.divider && <path className="orbit-divider" d={s.divider} />}
          <text className="orbit-sector" fontSize={s.size.toFixed(1)}>
            <textPath href={`#orbit-sector-${i}`} startOffset="50%" textAnchor="middle">
              {s.name}
            </textPath>
          </text>
        </g>
      ))}
    </svg>
  )
})

function Moons({ world, p, asked, onMoon }: { world: World; p: Placed; asked: string | null; onMoon: (s: Session) => void }) {
  if (!p.shape.rings.length) return null
  const us = p.shape.scale
  return (
    <span className="orbit-moons">
      {p.shape.rings.map((ring, ri) => (
        <span key={ri}>
          <span className="orbit-m-ring" style={vars({ '--mr': `${ring.r.toFixed(1)}px` })} />
          {ring.moons.map((m) => {
            const s = sessionOf(world, m.id)
            if (!s) return null
            const mr = (s.state === 'ended' ? 3 : 5.4) * us
            const sz = Math.ceil(mr * 2 + 6)
            return (
              <span key={m.id} className="orbit-m-orbit" data-spin={s.state === 'working' || undefined} style={vars({ '--a': `${m.angle}deg`, '--mr': `${ring.r.toFixed(1)}px`, '--dur': `${m.period}s` })}>
                <span className="orbit-m-arm">
                  <span className="orbit-m-un">
                    <span className="orbit-m-sq">
                      <span
                        className="orbit-moon"
                        data-moon={s.id}
                        data-state={s.state}
                        data-asked={asked === s.id || undefined}
                        title={`${s.title} · ${WORD[s.state]}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMoon(s)
                        }}
                      >
                        {(s.state === 'need' || s.state === 'stalled' || s.state === 'ready') && <i className="orbit-m-ping" />}
                        <svg width={sz} height={sz} viewBox={`${-sz / 2} ${-sz / 2} ${sz} ${sz}`} aria-hidden="true">
                          <Glyph state={s.state} r={mr} />
                        </svg>
                      </span>
                    </span>
                  </span>
                </span>
              </span>
            )
          })}
        </span>
      ))}
    </span>
  )
}

export interface BodyProps {
  world: World
  g: Geom
  p: Placed
  cursor: boolean
  /** The session whose card is open, when it is in this family. */
  asked: string | null
  matched: boolean
  onOpen: (id: string) => void
  onMoon: (s: Session) => void
}

/** A root session: its shape is its state, its size what its tree spent, the ring round it
 *  its context filling up (thicker past 80%), its moons its children. */
export const BodyMark = memo(function BodyMark({ world, g, p, cursor, asked, matched, onOpen, onMoon }: BodyProps) {
  const s = p.body.root
  const { r, R, fx, fy } = p.shape
  const sz = Math.ceil(R * 2 + 6)
  const around = Math.PI * 2 * R
  const ctx = s.context.percent
  return (
    <div
      className="orbit-body"
      data-body={s.id}
      data-state={s.state}
      data-band={p.body.band}
      data-cursor={cursor || undefined}
      data-asked={asked ? 'true' : undefined}
      data-match={matched || undefined}
      data-asset="session-body"
      role="button"
      aria-label={`${s.title}, ${WORD[s.state]}, ${p.body.project}`}
      style={vars({ transform: `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`, '--k': g.k.toFixed(3) })}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(s.id)
      }}
    >
      <span className="orbit-b-in" style={vars({ '--R': `${R.toFixed(1)}px` })}>
        {s.state === 'need' && (
          <>
            <i className="orbit-b-ping" />
            <i className="orbit-b-ping" data-second="true" />
          </>
        )}
        {s.state === 'ready' && <i className="orbit-b-halo" />}
        <svg className="orbit-b-g" width={sz} height={sz} viewBox={`${-sz / 2} ${-sz / 2} ${sz} ${sz}`} aria-hidden="true">
          {s.state !== 'ended' && <circle className="orbit-g-track" r={n(R)} />}
          {s.state !== 'ended' && ctx != null && <circle className="orbit-g-ctx" data-full={ctx >= 80 || undefined} r={n(R)} strokeDasharray={`${((around * Math.min(ctx, 100)) / 100).toFixed(1)} ${around.toFixed(1)}`} transform="rotate(-90)" />}
          <Glyph state={s.state} r={r} />
        </svg>
        {s.state === 'working' && (
          <span className="orbit-b-spark">
            <i />
          </span>
        )}
        <Moons world={world} p={p} asked={asked} onMoon={onMoon} />
        <i className="orbit-b-ret" style={vars({ '--F': `${(fx + 5).toFixed(1)}px`, '--Fy': `${(fy + 5).toFixed(1)}px` })} />
      </span>
      <i className="orbit-b-hit" style={vars({ '--F': `${Math.max(fx, 16).toFixed(1)}px` })} />
    </div>
  )
})

export interface LabelProps {
  world: World
  body: Body
  /** There is room for the line that says what it is doing. */
  roomy: boolean
  cursor: boolean
  matched: boolean
  /** Its card is open where it stands, so it steps aside. */
  asked: boolean
  spot: { x0: number; y0: number; align: 'l' | 'r' | 'c' } | undefined
  onOpen: (id: string) => void
  onWant: (p: Pending) => void
}

/** What a body carries: its full title beside its figure; its state in a shape and a word;
 *  its project (the rim is far from a body near the centre); what its tree spent; its
 *  context; how long since it moved. Then what waits, or what it is doing. */
export const LabelText = memo(function LabelText({ world, body, roomy, cursor, matched, asked, spot, onOpen, onWant }: LabelProps) {
  const s = body.root
  const want = body.pend[0]
  const counts = familyCounts(body.kids)
  const does = !want && roomy ? doing(s) : null
  return (
    <div
      className="orbit-lab"
      data-label={s.id}
      data-state={s.state}
      data-band={body.band}
      data-align={spot?.align ?? 'l'}
      data-cursor={cursor || undefined}
      data-match={matched || undefined}
      data-asked={asked || undefined}
      data-placed={spot ? 'true' : undefined}
      style={spot ? { transform: `translate(${Math.round(spot.x0)}px,${Math.round(spot.y0)}px)` } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(s.id)
      }}
    >
      <div className="orbit-lab-head">
        <Figure id={s.id} size={20} className="orbit-lab-figure" />
        <div className="orbit-lab-title">{s.title}</div>
      </div>
      <div className="orbit-lab-meta">
        <span className="orbit-st" data-state={s.state}>
          {GLYPH[s.state]} {WORD[s.state]}
        </span>
        <i>·</i>
        <span className="orbit-pj">{body.project}</span>
        <i>·</i>
        <span className="mn-num">{tokens(body.tree)}</span>
        {s.context.percent != null && s.state !== 'ended' && (
          <>
            <i>·</i>
            <span className="mn-num">{Math.round(s.context.percent)}%</span> ctx
          </>
        )}
        {body.lastAt != null && (
          <>
            <i>·</i>
            {age(body.lastAt, world.at)}
          </>
        )}
      </div>
      {body.kids.length > 0 && (
        <div className="orbit-lab-fam">
          <span>
            {body.kids.length} {body.kids.length > 1 ? 'children' : 'child'}
            {!counts.length && ' · all ended'}
          </span>
          {counts.map((c) => (
            <span key={c.state} className="orbit-st" data-state={c.state}>
              {GLYPH[c.state]} {c.n} {c.word}
            </span>
          ))}
        </div>
      )}
      {want && (
        <div
          className="orbit-lab-want"
          data-want={want.id}
          data-state={KIND_STATE[want.kind]}
          onClick={(e) => {
            e.stopPropagation()
            onWant(want)
          }}
        >
          <b>
            {KIND_GLYPH[want.kind]} {KIND_WORD[want.kind]}
          </b>{' '}
          {want.text.replace(/\s+/g, ' ').slice(0, 150)}
          {body.pend.length > 1 && <em> +{body.pend.length - 1} more</em>}
        </div>
      )}
      {does && (
        <div className="orbit-lab-doing" data-printed={does.printed || undefined}>
          {does.printed && '❯ '}
          {does.text.slice(0, 120)}
        </div>
      )}
    </div>
  )
})

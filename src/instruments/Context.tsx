// Context and tokens: how full the session is, how it got there, and what it cost.

import { useId } from 'react'
import { StateMark } from '../ds'
import { tokens as tok } from '../world/format'
import { select } from '../world/route'
import { Bar, Capped, None, Section, plural } from './parts'
import { limitName, took, until, when, type ContextReading, type Moment } from './read'

const W = 1000
const H = 300

/** The context over the session's life: the curve, a cliff at every compaction, and the
 *  moment read when it is not now. */
function Curve({ r, m }: { r: ContextReading; m: Moment }) {
  const clip = useId()
  if (r.series.length < 2) {
    return (
      <div className="instruments-chart" data-empty>
        <None>Too few calls to draw a curve.</None>
      </div>
    )
  }
  const from = r.series[0][0]
  const to = Math.max(r.series[r.series.length - 1][0], from + 1)
  const top = Math.max(r.window, ...r.series.map((p) => p[1]), 1)
  const x = (t: number) => ((t - from) / (to - from)) * W
  const y = (n: number) => H - (n / top) * H
  const d = r.series.map(([t, n], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(n).toFixed(1)}`).join('')
  const cliffs = r.compactions.map((c) => ({ ...c, x: x(c.at) })).filter((c) => c.x >= 0 && c.x <= W)
  const hand = r.cursor == null ? null : r.cursor * W
  const last = r.series[r.series.length - 1][1]
  const dot = hand == null ? { left: 100, top: (y(last) / H) * 100 } : r.tokens == null ? null : { left: (hand / W) * 100, top: (y(r.tokens) / H) * 100 }
  return (
    <div className="instruments-chart">
      <div className="instruments-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} className="instruments-chart-grid" x1={0} x2={W} y1={H * g} y2={H * g} />
          ))}
          {hand != null && (
            <clipPath id={clip}>
              <rect x={0} y={-20} width={hand} height={H + 40} />
            </clipPath>
          )}
          {/* At a past moment the whole life is drawn quiet and the part lived so far bright. */}
          {hand != null && <path className="instruments-chart-line" data-later d={d} />}
          <g clipPath={hand != null ? `url(#${clip})` : undefined}>
            <path className="instruments-chart-area" d={`${d}L${W} ${H}L0 ${H}Z`} />
            <path className="instruments-chart-line" d={d} />
          </g>
          {cliffs.map((c) => (
            <line key={c.at} className="instruments-chart-cliff" data-later={c.later || undefined} x1={c.x} x2={c.x} y1={0} y2={H} />
          ))}
          {hand != null && <line className="instruments-chart-hand" x1={hand} x2={hand} y1={0} y2={H} />}
        </svg>
        {cliffs.map((c) => (
          <i key={c.at} className="instruments-chart-mark" data-later={c.later || undefined} style={{ left: `${(c.x / W) * 100}%` }} />
        ))}
        <span className="instruments-chart-top mn-num">{tok(top)}</span>
        {dot && <span className="instruments-chart-now" style={{ left: `${dot.left}%`, top: `${dot.top}%` }} />}
      </div>
      <div className="instruments-chart-axis">
        <span>{when(r.series[0][0], m)}</span>
        <span>{when(r.series[r.series.length - 1][0], m)}</span>
      </div>
    </div>
  )
}

function compactionNote(r: ContextReading, m: Moment) {
  const all = r.compactions.length
  const last = r.lastCompaction
  if (!all) return <>Never compacted.</>
  if (!last) return <>Not compacted yet at this moment; {r.compactionsLater} later.</>
  const done = all - r.compactionsLater
  return (
    <>
      <b className="mn-num">{done}</b> {plural(done, 'compaction')}
      {m.past ? ' by then' : ''}. The last, {when(last.at, m)}, took <b className="mn-num">{tok(last.pre)}</b> down to <b className="mn-num">{tok(last.post)}</b>
      {last.trigger ? ` (${last.trigger})` : ''}.{r.compactionsLater ? ` ${r.compactionsLater} more later.` : ''}
    </>
  )
}

export function ContextBody({ r, m }: { r: ContextReading; m: Moment }) {
  const about = m.past ? '≈ ' : ''
  const max = Math.max(...r.kinds.map((k) => k.value), 1)
  const pct = r.percent == null ? null : Math.round(r.percent)
  const cost = r.cost
  return (
    <>
      <div className="instruments-big">
        <b className="instruments-big-n mn-num" data-hot={r.hot || undefined}>
          {pct ?? '–'}
          <small>%</small>
        </b>
        <div className="instruments-big-x">
          <span>
            <b className="mn-num">{tok(r.tokens)}</b> of a <b className="mn-num">{tok(r.window)}</b> window
          </span>
          <span className="instruments-big-q">
            {r.unborn ? 'not started yet at this moment' : r.tokens == null ? 'no call measured yet' : r.hot ? 'close to full, a compaction is near' : `${tok(r.free)} free`}
          </span>
        </div>
      </div>
      <Curve r={r} m={m} />
      <p className="instruments-note">{compactionNote(r, m)}</p>

      <Section title="Spent by this session" count={about + tok(r.spent)}>
        <div className="instruments-split">
          <span>
            <b className="mn-num">{tok(r.main)}</b> its own calls
          </span>
          {r.sidechain > 0 && (
            <span>
              <b className="mn-num">{tok(r.sidechain)}</b> side chain
            </span>
          )}
          {r.subagents.length > 0 && (
            <span>
              <b className="mn-num">{tok(r.subagentsSpent)}</b> {r.subagents.length} {plural(r.subagents.length, 'sub-agent')}
            </span>
          )}
        </div>
        {r.kinds.map((k) => (
          <div key={k.label} className="instruments-kind">
            <span className="instruments-kind-l">{k.label}</span>
            <Bar value={k.value ? Math.max(0.004, k.value / max) : 0} />
            <b className="mn-num">{tok(k.value)}</b>
            {k.thinking ? <small>{tok(k.thinking)} of it thinking</small> : null}
          </div>
        ))}
        {m.past && (
          <p className="instruments-note">
            An estimate: about <b className="mn-num">{Math.round(r.share * 100)}%</b> of what it has spent to now, by the context each call so far carried. The world keeps no history of spend.
          </p>
        )}
        {r.models.length > 0 && (
          <div className="instruments-rows" data-rows="models">
            {r.models.map((x) => (
              <div key={x.name} className="instruments-row">
                <span className="instruments-row-k">model</span>
                <span className="instruments-row-m">{x.name}</span>
                <b className="mn-num">{tok(x.spent)}</b>
              </div>
            ))}
          </div>
        )}
        {cost && (
          <p className="instruments-note" data-cost>
            Claude Code recorded <b className="mn-num">{`$${cost.usd.toFixed(2)}`}</b>
            {cost.apiMs ? `, ${took(cost.apiMs)} in the API` : ''}
            {cost.toolMs ? `, ${took(cost.toolMs)} in tools` : ''}
            {cost.linesAdded || cost.linesRemoved ? (
              <>
                , <b className="mn-num">+{cost.linesAdded.toLocaleString('en-US')}</b> <b className="mn-num">−{cost.linesRemoved.toLocaleString('en-US')}</b> lines
              </>
            ) : null}
            .
          </p>
        )}
      </Section>

      <Section title="Its sub-agents" count={r.subagents.length}>
        {r.subagents.length ? (
          <div className="instruments-rows">
            <Capped items={r.subagents} cap={6}>
              {(a) => (
                <div key={a.id} className="instruments-row">
                  <span className="instruments-row-m">{a.name}</span>
                  <span className="instruments-row-q">
                    {[a.type, `${a.calls.toLocaleString('en-US')} ${plural(a.calls, 'call')}`].filter(Boolean).join(' · ')}
                  </span>
                  <b className="mn-num">{tok(a.spent)}</b>
                </div>
              )}
            </Capped>
          </div>
        ) : (
          <None>It sent no sub-agent.</None>
        )}
      </Section>

      <Section title={r.tree.length > 1 ? 'Its tree' : 'Its tree is itself'} count={tok(r.treeSpent)}>
        {r.tree.length > 1 ? (
          <div className="instruments-rows" data-rows="tree">
            {r.tree.map((row) => (
              <button
                key={row.session.id}
                type="button"
                className="instruments-row instruments-tree"
                data-state={row.session.state}
                data-selected={row.selected || undefined}
                aria-current={row.selected || undefined}
                style={{ paddingLeft: `${row.depth * 1.1}em` }}
                onClick={() => select(row.session.id)}
              >
                <StateMark state={row.session.state} />
                <span className="instruments-row-m">{row.session.title}</span>
                <Bar value={row.share} tone={row.selected ? 'lit' : undefined} />
                <b className="mn-num">{tok(row.own)}</b>
              </button>
            ))}
          </div>
        ) : (
          <None>No children: the tree is this session.</None>
        )}
      </Section>

      <Section title="Plan windows" note={m.past ? 'as last read, not as of this moment' : undefined}>
        {r.accounts.length ? (
          r.accounts.map((a) => (
            <div key={a.id} className="instruments-plan" data-own={a.own || undefined}>
              <div className="instruments-plan-h">
                <b>{a.label}</b>
                <span>{a.plan ?? ''}</span>
                <small>{[a.own ? "this session's account" : '', a.stale ?? ''].filter(Boolean).join(' · ')}</small>
              </div>
              {a.limits.length ? (
                a.limits.map((l) => (
                  <div key={l.kind + (l.model ?? '')} className="instruments-kind" data-wide data-off={!l.active || undefined}>
                    <span className="instruments-kind-l">{limitName(l.kind, l.model)}</span>
                    <Bar value={l.percent / 100} />
                    <b className="mn-num">{`${Math.round(l.percent)}%`}</b>
                    <small>{[until(l.resetsAt, m.now), l.severity && l.severity !== 'normal' ? l.severity : ''].filter(Boolean).join(' · ')}</small>
                  </div>
                ))
              ) : (
                <None>No window read for this account.</None>
              )}
            </div>
          ))
        ) : (
          <None>No account read.</None>
        )}
      </Section>
    </>
  )
}

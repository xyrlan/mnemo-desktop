// Score: the day, left to right, a line per session, now at the right edge
// (docs/superpowers/specs/2026-11-10-recreation-front.md, "score"). The lines are a canvas that
// is drawn when something changed and never on a timer; the now column, the playhead and
// everything that moves are DOM over it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { Figure, Kbd, Label, Meter, StateMark } from '../ds'
import { Instruments } from '../instruments'
import { PendingCard, armedPending } from '../pending'
import { WORD, tokens } from '../world/format'
import { go, openOnStage, select, useRoute } from '../world/route'
import { sessionOf, useWorld } from '../world/store'
import type { Pending, Session, SessionState } from '../world/types'
import { drawRuler, drawScore, drawStrip, geom, hit, lookOf, stripOf, tOf, xOf, type Box, type Env, type Hit } from './draw'
import { HOUR, MIN, ctxAt, doingAt, fmt, foldableOf, mergedOf, ownAt, rows as rowsOf, scoreOf, spenders, stateAt, treeAt, type Row, type Score } from './model'
import { SPANS, backToNow, panBy, playhead, scoreKey, scoreStore, setSpan, setView, toggleFold, zoomAt } from './state'
import './score.css'

/* ---- what follows the cursor: kept apart, so moving the mouse never redraws the view ---- */

interface Tip {
  x: number
  y: number
  who: string
  what: ReactNode
  then: string[]
}
interface HoverState {
  /** The hairline's place on the track, in pixels, and the time written on it. */
  x: number | null
  label: string
  /** The row under the cursor. */
  row: number | null
  tip: Tip | null
}
const NO_HOVER: HoverState = { x: null, label: '', row: null, tip: null }
const hoverStore = create<HoverState>(() => NO_HOVER)
const noHover = () => {
  if (hoverStore.getState() !== NO_HOVER) hoverStore.setState(NO_HOVER, true)
}

const REASON: Record<string, string> = {
  judge_none_relevant: 'the judge found none relevant',
  notice_below_bar: 'below the bar for a notice',
  deduped: 'already given in this session',
  below_min_tokens: 'the prompt was too short',
  session_cap_reached: 'this session had its share',
  no_term_match: 'no rule shares a word with it',
  absolute_floor_fail: 'every candidate scored under the floor',
}

/** A mark under the cursor, in words. */
function describe(h: Hit): ReactNode {
  switch (h.kind) {
    case 'act':
      return (
        <>
          <b>{h.act.tool || h.act.kind}</b> <span className="mn-mono">{h.act.target}</span>
          <em>{h.act.ok === false ? 'failed' : h.act.running ? 'no result yet' : fmt.took(h.act.ms)}</em>
        </>
      )
    case 'mark': {
      const m = h.mark
      if (m.type === 'injected')
        return (
          <>
            <b data-memory>mnemo gave a rule</b> {m.ref.name ?? m.ref.slug}
            <em>
              score {(m.ref.score ?? 0).toFixed(2)}
              {m.ref.judge == null ? '' : ` · relevance ${m.ref.judge.toFixed(2)}`}
            </em>
          </>
        )
      if (m.type === 'asked')
        return (
          <>
            <b data-memory>it asked mnemo</b> {m.ref.slug ?? m.ref.topic ?? m.ref.query ?? m.ref.tool}
            <em>{m.ref.hits.length} hits</em>
          </>
        )
      if (m.type === 'held')
        return (
          <>
            <b data-memory>mnemo held back</b> {REASON[m.ref.reason] ?? m.ref.reason.replace(/_/g, ' ')}
            <em>{m.ref.candidates.length} candidates</em>
          </>
        )
      return (
        <>
          <b>{m.ref.op} Claude Code&rsquo;s memory</b> <span className="mn-mono">{fmt.tail(m.ref.path)}</span>
        </>
      )
    }
    case 'sight':
      return (
        <>
          <b>{{ shot: 'screenshot', artifact: 'artifact', search: 'searched', fetch: 'fetched' }[h.sight.type]}</b> {h.sight.text}
        </>
      )
    case 'compaction':
      return (
        <>
          <b>context compacted</b> {tokens(h.pre)} → {tokens(h.post)}
          <em>{h.trigger ?? ''}</em>
        </>
      )
    case 'prompt':
      return (
        <>
          <b>a prompt</b>
          <em>mnemo looked at it here</em>
        </>
      )
  }
}

function Hair() {
  const x = hoverStore((h) => h.x)
  const label = hoverStore((h) => h.label)
  if (x == null) return null
  return (
    <div className="score-hair" style={{ transform: `translateX(${x.toFixed(1)}px)` }} aria-hidden="true">
      <span>{label}</span>
    </div>
  )
}

function HoverBand({ boxes }: { boxes: Box[] }) {
  const row = hoverStore((h) => h.row)
  const box = row == null ? undefined : boxes[row]
  return box ? <div className="score-band" data-hover style={{ top: box.y, height: box.h }} /> : null
}

function TipBox() {
  const tip = hoverStore((h) => h.tip)
  if (!tip) return null
  const right = tip.x > window.innerWidth * 0.62
  const up = tip.y > window.innerHeight * 0.72
  return (
    <div
      className="score-tip"
      role="tooltip"
      style={{ left: right ? undefined : tip.x + 16, right: right ? window.innerWidth - tip.x + 16 : undefined, top: up ? undefined : tip.y + 18, bottom: up ? window.innerHeight - tip.y + 12 : undefined }}
    >
      <div className="score-tip-who">{tip.who}</div>
      {tip.what && <div className="score-tip-what">{tip.what}</div>}
      {tip.then.map((line) => (
        <div key={line} className="score-tip-then">
          {line}
        </div>
      ))}
    </div>
  )
}

/* ---- the now column: one compact card per line ---- */

const SHORT_WORD: Record<SessionState, string> = { ...WORD, ready: 'to merge' }

/** What the session is doing at `t`, in words it or its tools wrote. */
function doing(sc: Score, s: Session, t: number): { text: string; kind: 'wait' | 'tool' | 'said' | 'none' } {
  const d = sc.line(s)
  const p = sc.pend(s)
  if (t >= sc.now) {
    if (p) return { text: p.text || p.kind, kind: 'wait' }
    const last = d.acts[d.acts.length - 1]
    if (s.state === 'working' && last) return { text: `${last.tool}  ${last.target}`, kind: 'tool' }
    const words = s.recap?.text || s.said?.text || s.detail || s.intent || s.lastPrompt
    return words ? { text: words, kind: 'said' } : { text: 'nothing said yet', kind: 'none' }
  }
  if (d.t0 == null || t < d.t0) return { text: d.t0 == null ? '' : `starts ${fmt.when(d.t0, sc.now)}`, kind: 'none' }
  const what = doingAt(sc, s, t)
  if (what && 'act' in what) return { text: `${what.act.tool}  ${what.act.target}`, kind: 'tool' }
  if (what) return { text: `${what.bucket.total} tool calls in these five minutes`, kind: 'tool' }
  const waits = sc.pendAt(s)
  if (p && waits != null && t >= waits) return { text: p.text || 'waiting', kind: 'wait' }
  return { text: d.t1 != null && t > d.t1 ? `nothing since ${fmt.when(d.t1, sc.now)}` : 'silent', kind: 'none' }
}

function Shape({ state, word }: { state: SessionState | null; word?: string }) {
  if (!state)
    return (
      <span className="score-future">
        <i aria-hidden="true">◌</i>
        {word && <span className="mn-state-word">{word}</span>}
      </span>
    )
  return (
    <>
      <StateMark state={state} />
      {word && (
        <span className="mn-state-word" data-state={state}>
          {word}
        </span>
      )}
    </>
  )
}

function SessionRow({ sc, row, t, selected, waits }: { sc: Score; row: Extract<Row, { type: 'session' }>; t: number; selected: boolean; waits: Pending | null }) {
  const s = row.s
  const d = sc.line(s)
  const now = sc.now
  const live = t >= now
  const state = stateAt(sc, s, t)
  const compact = row.depth > 0 || s.role === 'child'
  const kids = sc.kids(s)
  const ended = foldableOf(sc, s).length
  const p = live ? sc.pend(s) : null
  const waited = sc.pendAt(s)
  const age = !live
    ? ''
    : p && waited != null
      ? `waiting ${fmt.span(now - waited)}`
      : state === 'idle' && d.t1 != null
        ? `silent ${fmt.span(now - d.t1)}`
        : state === 'ended' && d.t1 != null
          ? `${fmt.span(now - d.t1)} ago`
          : ''
  const words = doing(sc, s, t)
  const ctx = ctxAt(sc, s, t)
  const share = ctx == null ? null : (ctx / d.window) * 100
  const spent = kids.length ? treeAt(sc, s, t) : ownAt(sc, s, t)
  const about = live ? '' : '≈ '
  const main = { 'data-score-main': true, 'data-score-card': s.id, role: 'button', tabIndex: 0, onClick: () => select(s.id), onDoubleClick: () => openOnStage(s.id), 'aria-pressed': selected, title: 'Select; double-click or Enter opens it on stage' }
  return (
    <div className="score-row" data-score-row={s.id} data-state={state ?? 'future'} data-selected={selected || undefined} data-compact={compact || undefined} style={{ '--depth': row.depth } as React.CSSProperties}>
      {compact ? (
        <div className="score-card" {...main}>
          <Shape state={state} word={state ? SHORT_WORD[state] : 'not yet'} />
          <h3 className="score-title">{s.title}</h3>
          <b className="mn-num score-pct" data-hot={(share ?? 0) >= 85 || undefined}>
            {share == null ? '–' : Math.round(share) + '%'}
          </b>
          <span className="mn-num score-spent">
            {about}
            {tokens(spent)}
          </span>
        </div>
      ) : (
        <div className="score-card" {...main}>
          <div className="score-who">
            <Shape state={state} />
            <Figure id={s.id} size={24} />
          </div>
          <div className="score-body">
            <div className="score-meta">
              <span className="mn-state-word" data-state={state ?? undefined}>
                {state ? WORD[state] : 'not started'}
              </span>
              {age && <span className="score-age">{age}</span>}
              <span className="score-flex" />
              {s.project && <span className="score-project">{s.project}</span>}
            </div>
            <h3 className="score-title">{s.title}</h3>
            <div className="score-now-line">
              <div className="score-doing" data-kind={words.kind}>
                {words.text}
              </div>
              {ended > 0 && (
                <button
                  type="button"
                  className="score-chip"
                  title="Fold or unfold its ended children (F)"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    toggleFold(s.id)
                  }}
                >
                  {ended} ended
                </button>
              )}
            </div>
          </div>
          <div className="score-meters">
            <b className="mn-num score-pct" data-hot={(share ?? 0) >= 85 || undefined}>
              {share == null ? '–' : Math.round(share) + '%'}
            </b>
            <Meter value={(share ?? 0) / 100} width="100%" hot={(share ?? 0) >= 85} />
            <span className="score-of">{ctx == null ? 'context' : `${tokens(ctx)} of ${tokens(d.window)}`}</span>
            <span className="mn-num score-spent">
              {about}
              {tokens(spent)}
            </span>
            <span className="score-of">{kids.length ? 'its tree spent' : 'spent'}</span>
          </div>
        </div>
      )}
      {waits &&
        (live ? (
          <div className="score-ask">
            <PendingCard pending={waits} armed />
          </div>
        ) : (
          <button type="button" className="score-waits" data-state={s.state} onClick={() => backToNow()}>
            <b>It waits now.</b> <span>{waits.text}</span>
            <em>
              <Kbd>Esc</Kbd> back to now to answer
            </em>
          </button>
        ))}
    </div>
  )
}

function EnsembleRow({ sc, row, t }: { sc: Score; row: Extract<Row, { type: 'ensemble' }>; t: number }) {
  const merged = row.sessions.filter(mergedOf).length
  const n = row.sessions.length
  return (
    <div className="score-row" data-score-row={`ensemble:${row.parent.id}`} data-ensemble style={{ '--depth': row.depth } as React.CSSProperties}>
      <button type="button" className="score-ensemble" data-score-main title="Unfold these children into their own lines (F)" onClick={() => toggleFold(row.parent.id)}>
        <i aria-hidden="true">⑂</i>
        <span className="score-ensemble-what">
          {n} ended {n === 1 ? 'child' : 'children'}
          {merged ? ` · ${merged} merged` : ''}
        </span>
        <span className="mn-num">
          {t >= sc.now ? '' : '≈ '}
          {tokens(row.sessions.reduce((sum, s) => sum + ownAt(sc, s, t), 0))}
        </span>
        <span className="score-ensemble-hint">
          <Kbd>F</Kbd> unfold
        </span>
      </button>
    </div>
  )
}

/* ---- the legend under everything ---- */

const LEGEND: [string, string][] = [
  ['bar', 'a prompt'],
  ['curve', 'context filling'],
  ['l0', 'changes a file'],
  ['l1', 'runs something'],
  ['l2', 'reads or searches'],
  ['l3', 'reaches out'],
  ['dia', 'a rule mnemo gave'],
  ['dia hollow', 'a rule it asked for'],
  ['dot', 'a rule held back'],
  ['fail', 'a call that failed'],
  ['shot', 'a screenshot it took'],
]

/* ---- the view ---- */

const sameBoxes = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => x.y === b[i].y && x.h === b[i].h && x.h0 === b[i].h0)

/** One frame per input event: the newest call wins, and nothing runs at rest. */
function useFrame(): (fn: () => void) => void {
  const id = useRef(0)
  useEffect(() => () => cancelAnimationFrame(id.current), [])
  return useCallback((fn: () => void) => {
    cancelAnimationFrame(id.current)
    id.current = requestAnimationFrame(fn)
  }, [])
}

/** The whole-window time view. */
export function ScoreView() {
  const world = useWorld((w) => w)
  const route = useRoute((r) => r)
  const at = route.at
  const span = scoreStore((s) => s.span)
  const end = scoreStore((s) => s.end)
  const flip = scoreStore((s) => s.flip)
  const scrub = scoreStore((s) => s.scrub)

  const sc = scoreOf(world)
  const now = sc.now
  const ready = now > 0
  const t = playhead(now, at, scrub)
  const live = t >= now
  const to = end ?? now
  const from = to - span
  const following = end == null

  const selected = sessionOf(world, route.session) ?? null
  const session = selected?.id ?? null
  const list = useMemo(() => rowsOf(sc, new Set(flip), session), [sc, flip, session])
  const armed = armedPending(world, route)
  const pick = useMemo(() => (selected ? new Set([selected.id, ...sc.desc(selected).map((k) => k.id)]) : null), [sc, selected])

  const root = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const cards = useRef<HTMLDivElement>(null)
  const scoreC = useRef<HTMLCanvasElement>(null)
  const rulerC = useRef<HTMLCanvasElement>(null)
  const stripC = useRef<HTMLCanvasElement>(null)

  const [size, setSize] = useState({ W: 0, H: 0, strip: 0, ruler: 0 })
  const [top, setTop] = useState(0)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [fonts, setFonts] = useState(0)
  const [returning, setReturning] = useState(false)
  const frame = useFrame()

  const k = size.W > 0 ? size.W / span : 0
  const strip = useMemo(() => stripOf({ from, to, W: Math.max(1, size.W), sc, pick }), [from, to, size.W, sc, pick])
  const stepMs = strip.stepMs

  /** Where the rows are, read from the cards the DOM laid out: a waiting card can then grow in
   *  place without the two sides drifting. */
  const measure = useCallback(() => {
    const box = cards.current
    if (!box) return
    const next: Box[] = []
    for (const el of box.querySelectorAll<HTMLElement>(':scope > [data-score-row]')) {
      const main = el.querySelector<HTMLElement>('[data-score-main]')
      next.push({ y: el.offsetTop, h: el.offsetHeight, h0: main?.offsetHeight || el.offsetHeight })
    }
    setBoxes((was) => (sameBoxes(was, next) ? was : next))
    const W = track.current?.clientWidth ?? 0
    const H = scroller.current?.clientHeight ?? 0
    const stripH = stripC.current?.clientHeight ?? 0
    const rulerH = rulerC.current?.clientHeight ?? 0
    setSize((was) => (was.W === W && was.H === H && was.strip === stripH && was.ruler === rulerH ? was : { W, H, strip: stripH, ruler: rulerH }))
    if (W > 0 && scoreStore.getState().width !== W) scoreStore.setState({ width: W })
  }, [])
  useLayoutEffect(measure)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const seen = new ResizeObserver(measure)
    for (const el of [track.current, scroller.current, cards.current, head.current]) if (el) seen.observe(el)
    return () => seen.disconnect()
  }, [measure, ready])

  // The canvases use the three typefaces: draw again once they have loaded.
  useEffect(() => {
    const set = document.fonts
    if (!set) return
    let on = true
    const again = () => on && setFonts((n) => n + 1)
    void set.ready.then(again)
    set.addEventListener?.('loadingdone', again)
    return () => {
      on = false
      set.removeEventListener?.('loadingdone', again)
    }
  }, [])

  // The keys are the view's while focus is inside it: take it when nothing else has it.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) root.current?.focus({ preventScroll: true })
  }, [])

  // The selection is shared with the other views: keep its line in sight when it changes.
  useEffect(() => {
    if (!session) return
    const el = cards.current?.querySelector<HTMLElement>(`[data-score-row="${session}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [session])

  const env = useMemo<Env>(
    () => ({ W: size.W, H: size.H, top, from, to, k, sc, rows: list, boxes, sel: session, pick, look: lookOf(null) }),
    [size.W, size.H, top, from, to, k, sc, list, boxes, session, pick],
  )
  const current = useRef(env)
  current.current = env

  // Draw when something changed, once. The playhead is not among the reasons: a replay moves
  // DOM over the canvas and never redraws it.
  useEffect(() => {
    if (env.W < 1 || !scoreC.current || !rulerC.current || !stripC.current) return
    const drawn = { ...env, look: lookOf(root.current) }
    if (boxes.length === list.length) drawScore(scoreC.current, drawn)
    drawRuler(rulerC.current, drawn, size.ruler)
    drawStrip(stripC.current, drawn, size.strip, strip)
  }, [env, boxes, list, size.ruler, size.strip, strip, fonts])

  /* ---- the pointer on the score: hover, click a moment, drag through time ---- */

  const over = useCallback((clientX: number, clientY: number) => {
    const e = current.current
    const box = scoreC.current?.getBoundingClientRect()
    const home = root.current?.getBoundingClientRect()
    if (!box || !home || e.k <= 0) return null
    const px = clientX - box.left
    const py = clientY - box.top + e.top
    const i = e.boxes.findIndex((b) => py >= b.y && py < b.y + b.h)
    const row = i < 0 ? undefined : e.rows[i]
    const label = fmt.clockS(tOf(e, px))
    if (!row) {
      hoverStore.setState({ x: px, label, row: null, tip: null }, true)
      return null
    }
    const where = { x: clientX, y: clientY }
    if (row.type === 'ensemble') {
      hoverStore.setState({ x: px, label, row: i, tip: { ...where, who: `${row.sessions.length} ended children of ${row.parent.title}`, what: <em>click to give each its own line</em>, then: [] } }, true)
      return { row, t: tOf(e, px) }
    }
    const found = hit(e, i, px, py)
    const when = found ? found.t : tOf(e, px)
    const state = stateAt(e.sc, row.s, when)
    const ctx = ctxAt(e.sc, row.s, when)
    const then = `${fmt.when(when, e.sc.now)}:${fmt.clockS(when).slice(-2)} · ${state ? WORD[state] : 'not started'}${ctx == null ? '' : ` · context ${tokens(ctx)} (${Math.round((ctx / e.sc.line(row.s).window) * 100)}%)`}`
    hoverStore.setState({ x: px, label, row: i, tip: { ...where, who: row.s.title, what: found ? describe(found) : null, then: [then] } }, true)
    return { row, t: when }
  }, [])

  const drag = useRef<{ x: number; end: number; moved: boolean } | null>(null)
  const onScoreDown = (ev: PointerEvent<HTMLCanvasElement>) => {
    if (ev.button !== 0) return
    drag.current = { x: ev.clientX, end: to, moved: false }
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    root.current?.focus({ preventScroll: true })
  }
  const onScoreMove = (ev: PointerEvent<HTMLCanvasElement>) => {
    const { clientX, clientY } = ev
    const d = drag.current
    if (!d) return frame(() => over(clientX, clientY))
    const dx = clientX - d.x
    if (!d.moved && Math.abs(dx) < 5) return
    d.moved = true
    noHover()
    frame(() => current.current.k > 0 && setView(scoreStore.getState().span, d.end - dx / current.current.k))
  }
  const onScoreUp = (ev: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || ev.type === 'pointercancel') return
    const hitRow = over(ev.clientX, ev.clientY)
    if (!hitRow) return
    if (hitRow.row.type === 'ensemble') toggleFold(hitRow.row.parent.id)
    else go({ session: hitRow.row.s.id, pending: null, at: hitRow.t < now - 1000 ? Math.round(hitRow.t) : null })
  }

  /* ---- the ruler and the strip: drag to replay, let go to return to now ---- */

  const scrubbing = useRef(false)
  const timeAt = (clientX: number) => {
    const e = current.current
    const left = head.current?.getBoundingClientRect().left ?? 0
    return Math.min(e.sc.now, Math.max(e.from, tOf(e, clientX - left)))
  }
  const overStrip = useCallback((clientX: number, clientY: number, info: { stepMs: number }) => {
    const e = current.current
    const box = stripC.current?.getBoundingClientRect()
    if (!box || e.k <= 0) return
    const px = clientX - box.left
    const label = fmt.clockS(tOf(e, px))
    if (clientY > box.bottom) return hoverStore.setState({ x: px, label, row: null, tip: null }, true)
    const a = Math.floor(tOf(e, px) / info.stepMs) * info.stepMs
    const b = a + info.stepMs
    const top4 = spenders(e.sc, a, b)
    const total = top4.reduce((n, x) => n + x.tokens, 0)
    hoverStore.setState(
      {
        x: px,
        label,
        row: null,
        tip: {
          x: clientX,
          y: clientY,
          who: `${fmt.when(a, e.sc.now)} – ${fmt.clock(b)}`,
          what: (
            <>
              <b>≈ {tokens(total)}</b> across {top4.length} {top4.length === 1 ? 'session' : 'sessions'}
            </>
          ),
          then: top4.slice(0, 4).map((x) => `${tokens(x.tokens)} · ${x.s.title}`),
        },
      },
      true,
    )
  }, [])
  const onHeadDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0 || current.current.k <= 0) return
    scrubbing.current = true
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    root.current?.focus({ preventScroll: true })
    noHover()
    setReturning(false)
    scoreStore.setState({ scrub: timeAt(ev.clientX) })
  }
  const onHeadMove = (ev: PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = ev
    if (scrubbing.current) return frame(() => scrubbing.current && scoreStore.setState({ scrub: timeAt(clientX) }))
    frame(() => overStrip(clientX, clientY, { stepMs }))
  }
  const onHeadUp = (ev: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    const was = scoreStore.getState().scrub
    const held = ev.shiftKey && ev.type !== 'pointercancel' && was != null && was < now - 1000 ? Math.round(was) : null
    scoreStore.setState({ scrub: null })
    go({ at: held })
    if (held == null && was != null && was < now - 1000) setReturning(true)
  }
  useEffect(() => {
    if (!returning) return
    const id = setTimeout(() => setReturning(false), 420)
    return () => clearTimeout(id)
  }, [returning])

  // The wheel zooms over the ruler and the strip; over the score it scrolls the lines, zooms
  // with Ctrl and moves through time with Shift. (React's wheel listeners are passive.)
  useEffect(() => {
    const h = head.current
    const rowsEl = scroller.current
    if (!h || !rowsEl) return
    const onHead = (ev: WheelEvent) => {
      const e = current.current
      if (e.k <= 0) return
      ev.preventDefault()
      zoomAt(Math.exp(ev.deltaY * 0.0015), tOf(e, ev.clientX - h.getBoundingClientRect().left))
    }
    const onRows = (ev: WheelEvent) => {
      const e = current.current
      const box = track.current?.getBoundingClientRect()
      if ((!ev.ctrlKey && !ev.shiftKey) || !box || e.k <= 0 || ev.clientX > box.right) return
      ev.preventDefault()
      if (ev.ctrlKey) zoomAt(Math.exp(ev.deltaY * 0.0025), tOf(e, ev.clientX - box.left))
      else panBy((ev.deltaY || ev.deltaX) / e.k)
    }
    h.addEventListener('wheel', onHead, { passive: false })
    rowsEl.addEventListener('wheel', onRows, { passive: false })
    return () => {
      h.removeEventListener('wheel', onHead)
      rowsEl.removeEventListener('wheel', onRows)
    }
  }, [ready])
  useEffect(() => noHover, [])

  /* ---- keys: the view's own, while focus is inside it and never inside a text field ---- */

  const onKeyDown = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return
    const target = ev.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm')) return
    if (ev.key === 'Enter' || ev.key === ' ') {
      const card = target.closest<HTMLElement>('[data-score-card]')
      if (card?.dataset.scoreCard) {
        ev.preventDefault()
        ev.stopPropagation()
        if (ev.key === 'Enter') openOnStage(card.dataset.scoreCard)
        else select(card.dataset.scoreCard)
        return
      }
      if (target.closest('button, a')) return // a button's own key
    }
    if (scoreKey(ev.key, ev.shiftKey)) {
      ev.preventDefault()
      ev.stopPropagation()
    }
  }

  /* ---- what sits over the canvas ---- */

  // Before the first world arrives there is no now for the axis to end at.
  if (!ready)
    return (
      <section ref={root} className="score" data-view="score" data-empty tabIndex={-1} aria-label="Score: the fleet over time">
        <p className="score-empty">Reading the fleet…</p>
      </section>
    )

  const px = k > 0 ? xOf({ from, k }, t) : 0
  const replayOn = !live && k > 0 && px >= 0 && px <= size.W
  const lines = list.filter((r) => r.type === 'session').length
  const total = world.sessions.reduce((n, s) => n + ownAt(sc, s, t), 0)
  const stripNote = `per ${stepMs < HOUR ? stepMs / MIN + ' min' : stepMs / HOUR + ' h'} · peak ${tokens(strip.peak)}${selected ? ' · white is the selected line and its children' : ''} · estimated from each call’s context`

  return (
    <section ref={root} className="score" data-view="score" data-inspector={selected ? 'open' : 'closed'} data-replay={live ? 'off' : 'on'} data-follow={following ? 'yes' : 'no'} tabIndex={-1} onKeyDown={onKeyDown} aria-label="Score: the fleet over time">
      <header className="score-bar">
        <div className="score-range">
          <b>
            {fmt.day(from)} {fmt.clock(from)}
          </b>{' '}
          → <b>{following ? 'now' : `${fmt.day(to)} ${fmt.clock(to)}`}</b>
          {!following && (
            <button type="button" className="score-tonow" onClick={() => setView(span, null)}>
              to now
            </button>
          )}
        </div>
        <nav className="score-zoom" aria-label="Zoom">
          {SPANS.map(([name, ms]) => (
            <button key={name} type="button" data-on={ms === span || undefined} onClick={() => setSpan(ms)}>
              {name}
            </button>
          ))}
        </nav>
        <span className="score-flex" />
        <div className="score-keys">
          <span>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> replay
          </span>
          <span>
            <Kbd>Esc</Kbd> back to now
          </span>
          <span>
            <Kbd>+</Kbd>
            <Kbd>−</Kbd> zoom
          </span>
          <span>
            <Kbd>F</Kbd> fold
          </span>
          <span>
            <Kbd>Enter</Kbd> on stage
          </span>
        </div>
      </header>

      <div className="score-main">
        <div ref={head} className="score-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp} onPointerLeave={() => !scrubbing.current && frame(noHover)}>
          <div className="score-striplabel">
            <Label>Fleet tokens</Label>
            <span>{stripNote}</span>
          </div>
          <canvas ref={stripC} className="score-strip" />
          <canvas ref={rulerC} className="score-ruler" />
        </div>

        <div className="score-nowhead">
          <div className="score-now">
            <div className="score-clock">
              <Label>{live ? 'Now' : 'As of'}</Label>
              <b className="mn-num">{fmt.clock(t)}</b>
              <span>{fmt.day(t)}</span>
            </div>
            <div className="score-fleet">
              <b className="mn-num">
                {live ? '' : '≈ '}
                {tokens(total)}
              </b>
              <Label>tokens · {world.sessions.length} sessions</Label>
            </div>
          </div>
          <div className="score-colhead" data-replay={live ? undefined : true}>
            {live ? (
              <>
                <Label>{lines} lines</Label>
                <Label className={world.pending.length ? 'score-wait' : undefined}>{world.pending.length ? `${world.pending.length} waiting` : 'nothing waits'}</Label>
              </>
            ) : (
              <>
                <Label>replay · {fmt.span(now - t)} ago</Label>
                <button type="button" className="score-back" onClick={() => backToNow()}>
                  Now <Kbd>Esc</Kbd>
                </button>
              </>
            )}
          </div>
        </div>

        <div ref={scroller} className="score-rows" onScroll={(ev) => (noHover(), setTop(ev.currentTarget.scrollTop))}>
          <div className="score-inner">
            <div ref={track} className="score-track">
              <div className="score-under">
                {list.map((row, i) => (row.type === 'session' && row.s.id === session && boxes[i] ? <div key={row.s.id} className="score-band" data-selected style={{ top: boxes[i].y, height: boxes[i].h }} /> : null))}
                <HoverBand boxes={boxes} />
              </div>
              <canvas ref={scoreC} className="score-canvas" style={{ height: size.H || undefined }} onPointerDown={onScoreDown} onPointerMove={onScoreMove} onPointerUp={onScoreUp} onPointerCancel={onScoreUp} onPointerLeave={() => !drag.current && frame(noHover)} />
              <div className="score-over">
                {k > 0 &&
                  list.map((row, i) => {
                    const box = boxes[i]
                    if (row.type !== 'session' || !box) return null
                    const s = row.s
                    const g = geom(row, box)
                    const waited = sc.pendAt(s)
                    if (sc.pend(s) && waited != null) {
                      const left = Math.max(0, Math.min(size.W - 28, xOf({ from, k }, waited)))
                      return (
                        <div key={s.id}>
                          {following && (
                            <div className="score-waiting" data-state={s.state} style={{ top: g.yB - 9, left, width: size.W - left }}>
                              <i />
                              {size.W - left > 120 && <span>waiting {fmt.span(now - waited)}</span>}
                            </div>
                          )}
                          {live && armed?.session === s.id && box.h - box.h0 > 60 && (
                            <div className="score-waitbig" data-state={s.state} style={{ top: box.y + box.h0 + 6 }}>
                              <b className="mn-num">{fmt.span(now - waited)}</b>
                              <Label>it has waited since {fmt.when(waited, now)}</Label>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return s.state === 'working' && following ? <div key={s.id} className="score-pulse" style={{ top: g.yB, left: size.W }} /> : null
                  })}
              </div>
            </div>
            <div ref={cards} className="score-cards">
              {list.map((row) =>
                row.type === 'ensemble' ? (
                  <EnsembleRow key={`ensemble:${row.parent.id}`} sc={sc} row={row} t={t} />
                ) : (
                  <SessionRow key={row.s.id} sc={sc} row={row} t={t} selected={row.s.id === session} waits={armed?.session === row.s.id ? armed : null} />
                ),
              )}
              {!list.length && <p className="score-empty">No session yet. A line appears here when one starts.</p>}
            </div>
          </div>
        </div>

        {/* the plane over the track: the seam where the past meets now, the playhead, the hairline */}
        <div className="score-plane" aria-hidden="true">
          <div className="score-seam" />
          {replayOn && <div className="score-dim" style={{ left: px, width: Math.max(0, size.W - px) }} />}
          <Hair />
          {(replayOn || returning) && (
            <div className="score-playhead" data-returning={returning && !replayOn ? true : undefined} style={{ transform: `translateX(${(replayOn ? px : size.W).toFixed(1)}px)` }}>
              <span data-flip={replayOn && px > size.W - 190 ? true : undefined}>{replayOn ? `${fmt.when(t, now)}  ·  ${fmt.span(now - t)} ago` : 'now'}</span>
            </div>
          )}
        </div>

        {selected && (
          <aside className="score-side" aria-label="Selected session">
            <header className="score-sidehead" data-state={stateAt(sc, selected, t) ?? 'future'}>
              <div className="score-sidetop">
                <Shape state={stateAt(sc, selected, t)} word={stateAt(sc, selected, t) ? WORD[stateAt(sc, selected, t)!] : 'not started'} />
                {!live && <span className="score-asof">as of {fmt.when(t, now)}</span>}
                <span className="score-flex" />
                <button type="button" className="score-ghost" onClick={() => openOnStage(selected.id)}>
                  On stage <Kbd>Enter</Kbd>
                </button>
                <button type="button" className="score-ghost" onClick={() => select(null)}>
                  Close <Kbd>Esc</Kbd>
                </button>
              </div>
              <div className="score-sidename">
                <Figure id={selected.id} size={40} />
                <h2>{selected.title}</h2>
              </div>
              <div className="score-doing" data-kind={doing(sc, selected, t).kind}>
                {doing(sc, selected, t).text}
              </div>
            </header>
            <div className="score-instruments">
              <Instruments sessionId={selected.id} at={live ? null : t} />
            </div>
          </aside>
        )}
      </div>

      <footer className="score-legend" aria-label="Marks on a line">
        {LEGEND.map(([cls, what]) => (
          <span key={cls}>
            <i className={`score-lg ${cls}`} />
            {what}
          </span>
        ))}
        <span className="score-flex" />
        <span>≈ is an estimate</span>
        <span>drag the ruler to replay · wheel on it to zoom · click a line to hold a moment</span>
      </footer>
      <TipBox />
    </section>
  )
}

// What is the score's own: how much time the axis holds and where it ends, which parents are
// folded, and the playhead while it is dragged. The selection and the held playhead are the
// route's (`route.session`, `route.at`), so they are the same in every view.
//
// Everything a key does here is a function, so the frame can route a key to the score without
// the score listening on `window` (`scoreKey`).

import { create } from 'zustand'
import { armedPending } from '../pending'
import { go, openOnStage, routeStore, select } from '../world/route'
import { sessionOf, worldStore } from '../world/store'
import { DAY, HOUR, MIN, canFold, earliest, scoreOf, step } from './model'

export const DEFAULT_SPAN = 12 * HOUR
export const MIN_SPAN = 10 * MIN
export const MAX_SPAN = 14 * DAY
/** The zooms that are one click away. */
export const SPANS: [string, number][] = [
  ['48h', 48 * HOUR],
  ['24h', 24 * HOUR],
  ['12h', 12 * HOUR],
  ['6h', 6 * HOUR],
  ['2h', 2 * HOUR],
  ['30m', 30 * MIN],
]

export interface ScoreState {
  /** How much time the axis holds, in ms. */
  span: number
  /** The axis's right edge; null follows now. */
  end: number | null
  /** Parents (ids) whose fold is the opposite of the default. */
  flip: string[]
  /** The playhead while it is dragged on the ruler; null when it is not. */
  scrub: number | null
  /** The track's width in pixels: what one step of the playhead is measured against. */
  width: number
}

const KEY = 'mnemo.score'
const clampSpan = (span: number) => Math.min(MAX_SPAN, Math.max(MIN_SPAN, span))

const UNIT = { m: MIN, h: HOUR, d: DAY }
export function parseSpan(text: string | null): number | null {
  const m = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(text ?? '')
  return m ? clampSpan(Number(m[1]) * UNIT[m[2] as keyof typeof UNIT]) : null
}
export const spanText = (span: number): string => (span % HOUR === 0 ? span / HOUR + 'h' : Math.round(span / MIN) + 'm')

/** The zoom and the folds are kept from one run to the next; where the axis ends is not, so
 *  the app never opens on yesterday. */
function kept(): Pick<ScoreState, 'span' | 'flip'> {
  try {
    const q = new URLSearchParams(localStorage.getItem(KEY) ?? '')
    return { span: parseSpan(q.get('span')) ?? DEFAULT_SPAN, flip: (q.get('fold') ?? '').split(',').filter(Boolean) }
  } catch {
    return { span: DEFAULT_SPAN, flip: [] }
  }
}

export const scoreStore = create<ScoreState>(() => ({ ...kept(), end: null, scrub: null, width: 1200 }))

function keep(): void {
  const { span, flip } = scoreStore.getState()
  try {
    const q = new URLSearchParams()
    if (span !== DEFAULT_SPAN) q.set('span', spanText(span))
    if (flip.length) q.set('fold', flip.join(','))
    localStorage.setItem(KEY, q.toString())
  } catch {
    // no storage: the store is the state
  }
}

const world = () => worldStore.getState().world
const route = () => routeStore.getState().route

/** The moment every reading is shown at: the playhead being dragged, else the one held in the
 *  route, else now. */
export function playhead(now: number, at: number | null, scrub: number | null): number {
  const t = scrub ?? at
  return t != null && t < now ? t : now
}

/** Set the zoom and the right edge. An edge at now, or past it, follows now. */
export function setView(span: number, end: number | null): void {
  const sc = scoreOf(world())
  const next = clampSpan(span)
  const floor = earliest(sc) + next * 0.5
  scoreStore.setState({ span: next, end: end == null || end >= sc.now - 1000 ? null : Math.max(end, floor) })
  keep()
}

/** Zoom to `span`, keeping a held playhead where it is on the screen when it is in view;
 *  else keeping the right edge. */
export function setSpan(span: number): void {
  const now = world().at
  const { span: was, end } = scoreStore.getState()
  const to = end ?? now
  const t = playhead(now, route().at, null)
  if (t < now && t > to - was) setView(span, t + (to - t) * (clampSpan(span) / was))
  else setView(span, end)
}

/** Zoom by `factor` around the moment `anchor`, which stays where it is on the screen. */
export function zoomAt(factor: number, anchor: number): void {
  const { span: was, end } = scoreStore.getState()
  const to = end ?? world().at
  const span = clampSpan(was * factor)
  setView(span, anchor + (to - anchor) * (span / was))
}

/** Move the axis by `ms`: negative is back in time. */
export function panBy(ms: number): void {
  const { span, end } = scoreStore.getState()
  setView(span, (end ?? world().at) + ms)
}

/** Step the held playhead by `delta` steps (negative is back). At now it lets go. The axis
 *  follows a playhead that leaves it. */
export function movePlayhead(delta: number): void {
  const sc = scoreOf(world())
  const { span, end, width } = scoreStore.getState()
  const from = playhead(sc.now, route().at, null)
  const next = Math.max(earliest(sc), from + step(span, width, 24) * delta)
  const at = next >= sc.now ? null : Math.round(next)
  go({ at })
  if (at == null) return
  const to = end ?? sc.now
  if (at < to - span || at > to) setView(span, at + span * 0.5)
}

/** Fold or unfold a parent's ended children. */
export function toggleFold(parentId: string): void {
  const { flip } = scoreStore.getState()
  scoreStore.setState({ flip: flip.includes(parentId) ? flip.filter((id) => id !== parentId) : [...flip, parentId] })
  keep()
}

/** Let the playhead go and follow now again. False when it already did. */
export function backToNow(): boolean {
  const { end, scrub } = scoreStore.getState()
  if (route().at == null && end == null && scrub == null) return false
  scoreStore.setState({ end: null, scrub: null })
  go({ at: null })
  return true
}

/** A key pressed while the score has the keys. True when it meant something here, so the
 *  caller stops it there; false leaves it to the frame.
 *
 *    ← →      step the playhead (Shift: six steps); the now column replays
 *    + − 0    zoom in, out, and back to 12 hours ending now
 *    F        fold or unfold the selected line's ended children
 *    Enter    the selected session, on stage
 *    Esc      back to now, then close the selection (never while a panel or the command
 *             line is open: closing those is the frame's)
 *    1–9, R   with the playhead held in the past: back to now first, where a waiting item is
 *             answered. At now they are the frame's. */
export function scoreKey(key: string, shift = false): boolean {
  const w = world()
  if (!w.sessions.length) return false
  const r = route()
  const sc = scoreOf(w)
  const k = key.length === 1 ? key.toLowerCase() : key
  const t = playhead(sc.now, r.at, scoreStore.getState().scrub)
  const anchor = t < sc.now ? t : (scoreStore.getState().end ?? sc.now)
  switch (k) {
    case 'ArrowLeft':
      movePlayhead(shift ? -6 : -1)
      return true
    case 'ArrowRight':
      movePlayhead(shift ? 6 : 1)
      return true
    case '+':
    case '=':
      zoomAt(0.5, anchor)
      return true
    case '-':
    case '_':
      zoomAt(2, anchor)
      return true
    case '0':
      setView(DEFAULT_SPAN, null)
      return true
    case 'f': {
      const s = sessionOf(w, r.session)
      const parent = s && (canFold(sc, s) ? s : sessionOf(w, s.parent))
      if (!parent || !canFold(sc, parent)) return false
      toggleFold(parent.id)
      return true
    }
    case 'Enter':
      if (!sessionOf(w, r.session)) return false
      openOnStage(r.session!)
      return true
    case 'Escape':
      // a panel or the command line that is open closes first, and that is the frame's
      if (r.panel || r.command) return false
      if (backToNow()) return true
      if (!r.session) return false
      select(null)
      return true
    default:
      if ((/^[1-9]$/.test(k) || k === 'r') && t < sc.now && armedPending(w, r)) return backToNow()
      return false
  }
}

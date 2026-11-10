// What the score derives from the world: each session's span on the time axis, its marks, what
// it looked like at any earlier moment, and the order of the lines. No DOM in this file.
//
// The world is what is known now, so three readings here are estimates, and the view marks
// them with "≈" wherever it shows one:
// - spent by a moment: the session's total, shared out along its context curve (a call costs
//   about the context it carries);
// - state at a moment: working where tool calls are, idle where they are not;
// - a prompt: a moment mnemo looked at one (the trail's `injected` and `considered`).

import { sum } from '../world/format'
import { childrenOf, pendingOf, roots } from '../world/store'
import type { ClaudeMemory, Context, Pending, PlanLimit, Session, SessionState, ToolCall, Trail, Web, World } from '../world/types'

export const MIN = 60e3
export const HOUR = 3600e3
export const DAY = 24 * HOUR
/** `Session.timeline` is tool calls per 5 minutes. */
export const BUCKET = 5 * MIN

/* A tool call sits on one of four lanes under the line, by what it does to the world:
   0 changes files, 1 runs something, 2 looks, 3 reaches out (web, sub-agents, the maintainer).
   A mnemo call (kind `memory`) goes to the diamond lane above the line instead. */
const LANE: Record<string, number> = {
  edit: 0, write: 0,
  shell: 1, mcp: 1,
  read: 2, 'search-code': 2, meta: 2, other: 2,
  'web-search': 3, 'web-fetch': 3, browser: 3, artifact: 3, agent: 3, message: 3, skill: 3, ask: 3,
}
export const LANE_NAMES = ['changes files', 'runs', 'looks', 'reaches out'] as const
export const laneOf = (kind: string): number => (kind === 'memory' ? -1 : (LANE[kind] ?? 2))

/** Index of the last item whose time is at or before `t`, or -1. `get` reads an item's time. */
export function lastAtOrBefore<T>(list: readonly T[], t: number, get: (item: T) => number): number {
  let lo = 0
  let hi = list.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (get(list[mid]) <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export interface Act extends ToolCall {
  lane: number
}

export interface BucketRow {
  t: number
  lanes: [number, number, number, number]
  mem: number
  total: number
}

export type Mark =
  | { t: number; type: 'injected'; ref: Trail['injected'][number] }
  | { t: number; type: 'asked'; ref: Trail['read'][number] }
  | { t: number; type: 'held'; ref: Trail['considered'][number] }
  | { t: number; type: 'claude'; ref: ClaudeMemory['touches'][number] }

export interface Sight {
  t: number
  type: 'shot' | 'artifact' | 'search' | 'fetch'
  text: string
}

/** One session on the time axis. */
export interface Line {
  /** The earliest and the latest thing known of it; null when nothing is. */
  t0: number | null
  t1: number | null
  series: [number, number][]
  /** The running sum of `series`, and its total: what a moment's share of the spending is read from. */
  cum: Float64Array
  weight: number
  acts: Act[]
  buckets: BucketRow[]
  busy: Set<number>
  marks: Mark[]
  prompts: number[]
  sights: Sight[]
  compactions: Context['compactions']
  asked: number
  own: number
  window: number
}

const known = (t: number | null | undefined): t is number => t != null && Number.isFinite(t) && t > 0

function build(s: Session): Line {
  const series = s.context.series.filter((p) => known(p[0]) && p[1] != null).sort((a, b) => a[0] - b[0])
  const acts: Act[] = s.activity
    .filter((a) => known(a.at))
    .map((a) => ({ ...a, lane: laneOf(a.kind) }))
    .sort((a, b) => a.at - b.at)
  const buckets: BucketRow[] = s.timeline
    .filter((b) => known(b.t))
    .map((b) => {
      const lanes: [number, number, number, number] = [0, 0, 0, 0]
      let mem = 0
      let total = 0
      for (const [kind, n] of Object.entries(b.kinds)) {
        const lane = laneOf(kind)
        if (lane < 0) mem += n ?? 0
        else lanes[lane] += n ?? 0
        total += n ?? 0
      }
      return { t: b.t, lanes, mem, total }
    })
    .sort((a, b) => a.t - b.t)
  const busy = new Set(buckets.filter((b) => b.total > 0).map((b) => Math.floor(b.t / BUCKET)))

  // A resumed session's transcript starts long before the process did: the line starts at
  // the earliest thing known about it.
  const starts = [s.startedAt, series[0]?.[0], acts[0]?.at, buckets[0]?.t].filter(known)
  const ends = [s.lastAt, series[series.length - 1]?.[0], acts[acts.length - 1]?.at].filter(known)
  const t0 = starts.length ? Math.min(...starts) : null
  const t1 = ends.length ? Math.max(...ends) : t0

  const within = (t: number) => known(t) && t0 != null && t >= t0 - MIN && (s.live || t <= (t1 ?? t0) + MIN)
  const trail = s.memory.trail
  const marks: Mark[] = [
    ...trail.injected.map((ref): Mark => ({ t: ref.at, type: 'injected', ref })),
    ...trail.read.map((ref): Mark => ({ t: ref.at, type: 'asked', ref })),
    ...trail.considered.map((ref): Mark => ({ t: ref.at, type: 'held', ref })),
    ...s.memory.claude.touches.map((ref): Mark => ({ t: ref.at, type: 'claude', ref })),
  ]
    .filter((m) => within(m.t))
    .sort((a, b) => a.t - b.t)

  const prompts: number[] = []
  const looked = [...trail.injected, ...trail.considered].map((x) => x.at).filter(within).sort((a, b) => a - b)
  for (const t of looked) if (!prompts.length || t - prompts[prompts.length - 1] > 2000) prompts.push(t)

  const web: Web = s.web
  const sights: Sight[] = [
    ...web.shots.map((x): Sight => ({ t: x.at, type: 'shot', text: x.title || x.url || '' })),
    ...web.artifacts.map((x): Sight => ({ t: x.at, type: 'artifact', text: x.title || x.url })),
    ...web.searches.map((x): Sight => ({ t: x.at, type: 'search', text: x.query })),
    ...web.fetches.map((x): Sight => ({ t: x.at, type: 'fetch', text: x.url })),
  ]
    .filter((m) => within(m.t))
    .sort((a, b) => a.t - b.t)

  const cum = new Float64Array(series.length)
  let weight = 0
  for (let i = 0; i < series.length; i++) {
    weight += Math.max(0, series[i][1])
    cum[i] = weight
  }

  return {
    t0, t1, series, cum, weight, acts, buckets, busy, marks, prompts, sights,
    compactions: s.context.compactions.filter((c) => known(c.at)).sort((a, b) => a.at - b.at),
    asked: trail.read.length,
    own: sum(s.totals.own) || sum(s.tokens.main),
    window: s.context.window || 200_000,
  }
}

// A line is worked out once per session object: the live world hands back the same object for
// a session whose data did not change, so a poll costs nothing here.
const lines = new WeakMap<Session, Line>()

/** The world as the score reads it: every session's line, its family, what waits on it. */
export interface Score {
  world: World
  now: number
  line(s: Session): Line
  /** A session's children, most urgent first, and everything under it. */
  kids(s: Session): Session[]
  desc(s: Session): Session[]
  /** What waits on it (the oldest item), and since when. */
  pend(s: Session): Pending | null
  pendAt(s: Session): number | null
}

const scores = new WeakMap<World, Score>()

export function scoreOf(world: World): Score {
  const hit = scores.get(world)
  if (hit) return hit
  const kids = new Map<string, Session[]>()
  const desc = new Map<string, Session[]>()
  const line = (s: Session): Line => {
    let made = lines.get(s)
    if (!made) lines.set(s, (made = build(s)))
    return made
  }
  const kidsOf = (s: Session): Session[] => {
    let list = kids.get(s.id)
    if (!list) kids.set(s.id, (list = childrenOf(world, s, true)))
    return list
  }
  const walk = (s: Session, seen: Set<string>): Session[] => {
    const out: Session[] = []
    for (const k of kidsOf(s)) {
      if (seen.has(k.id)) continue
      seen.add(k.id)
      out.push(k, ...walk(k, seen))
    }
    return out
  }
  const pend = (s: Session): Pending | null => pendingOf(world, s.id)[0] ?? null
  const made: Score = {
    world,
    now: world.at,
    line,
    kids: kidsOf,
    desc(s) {
      let list = desc.get(s.id)
      if (!list) desc.set(s.id, (list = walk(s, new Set([s.id]))))
      return list
    },
    pend,
    pendAt(s) {
      const p = pend(s)
      return p ? (p.since ?? line(s).t1) : null
    },
  }
  scores.set(world, made)
  return made
}

/* ---- a session at a moment ---- */

/** Context tokens at `t`: the last call's size, held until the next one. */
export function ctxAt(sc: Score, s: Session, t: number): number | null {
  const d = sc.line(s)
  if (t >= sc.now) return s.context.tokens
  if (d.t0 == null || t < d.t0) return null
  const i = lastAtOrBefore(d.series, t, (p) => p[0])
  return i < 0 ? null : d.series[i][1]
}

/** The share of the session's spending that had happened by `t`, 0..1. */
export function spentShare(sc: Score, s: Session, t: number): number {
  const d = sc.line(s)
  if (t >= sc.now || d.t0 == null) return 1
  if (t <= d.t0) return 0
  if (!d.weight) return d.t1 != null && d.t1 > d.t0 ? Math.min(1, (t - d.t0) / (d.t1 - d.t0)) : 1
  const i = lastAtOrBefore(d.series, t, (p) => p[0])
  return i < 0 ? 0 : d.cum[i] / d.weight
}

export const ownAt = (sc: Score, s: Session, t: number): number => sc.line(s).own * spentShare(sc, s, t)

/** What the session and everything under it had spent by `t`. */
export function treeAt(sc: Score, s: Session, t: number): number {
  if (t >= sc.now) return Math.max(sc.line(s).own, sum(s.totals.tree))
  return ownAt(sc, s, t) + sc.desc(s).reduce((n, k) => n + ownAt(sc, k, t), 0)
}

export function busyAt(sc: Score, s: Session, t: number): boolean {
  const d = sc.line(s)
  if (d.busy.has(Math.floor(t / BUCKET))) return true
  const i = lastAtOrBefore(d.acts, t, (a) => a.at)
  if (i >= 0 && t - d.acts[i].at < 2 * MIN) return true
  return i + 1 < d.acts.length && d.acts[i + 1].at - t < MIN
}

/** The state at `t`; null is "not started yet". At now it is the world's own. */
export function stateAt(sc: Score, s: Session, t: number): SessionState | null {
  const d = sc.line(s)
  if (t >= sc.now) return s.state
  if (d.t0 == null || t < d.t0) return null
  const waits = sc.pendAt(s)
  if (waits != null && t >= waits) return s.state
  if (d.t1 != null && t > d.t1) return s.live || waits != null ? 'idle' : s.state
  return busyAt(sc, s, t) ? 'working' : 'idle'
}

/** What it was doing at `t`: the tool call under way or just finished, else how busy the
 *  five minutes around it were. */
export function doingAt(sc: Score, s: Session, t: number): { act: Act } | { bucket: BucketRow } | null {
  const d = sc.line(s)
  const i = lastAtOrBefore(d.acts, t, (a) => a.at)
  if (i >= 0 && t - d.acts[i].at < 10 * MIN) return { act: d.acts[i] }
  const b = d.buckets[lastAtOrBefore(d.buckets, t, (x) => x.t)]
  if (b && t - b.t < BUCKET && b.total) return { bucket: b }
  return null
}

export const mergedOf = (s: Session): boolean => s.prs.some((p) => p.state === 'merged')

/* ---- the order of the lines ---- */

export type Row =
  | { type: 'session'; s: Session; depth: number }
  | { type: 'ensemble'; parent: Session; sessions: Session[]; depth: number }

/** An ended child with nothing waiting on or under it can fold into its parent's ensemble lane. */
const foldable = (sc: Score, k: Session): boolean => k.state === 'ended' && !sc.pend(k) && sc.desc(k).every((x) => x.state === 'ended' && !sc.pend(x))

/** The children of `s` that can fold. */
export const foldableOf = (sc: Score, s: Session): Session[] => sc.kids(s).filter((k) => foldable(sc, k))
export const canFold = (sc: Score, s: Session): boolean => foldableOf(sc, s).length > 0

/** Rows top to bottom, in the roster's order: each root, then its children, each followed by
 *  its own. Three or more ended children fold into one thin "ensemble" lane; `flipped` holds
 *  the parents (ids) whose fold is the opposite of that default. `keep` is the selected
 *  session, which always has a line of its own. */
export function rows(sc: Score, flipped: ReadonlySet<string>, keep: string | null = null): Row[] {
  const out: Row[] = []
  const seen = new Set<string>()
  const add = (s: Session, depth: number) => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    out.push({ type: 'session', s, depth })
    const kids = sc.kids(s)
    const can = foldableOf(sc, s)
    const fold = can.length >= 3 !== flipped.has(s.id)
    const packed = fold ? can.filter((k) => k.id !== keep && !sc.desc(k).some((x) => x.id === keep)) : []
    for (const k of kids) if (!packed.includes(k)) add(k, depth + 1)
    if (packed.length) {
      const all: Session[] = []
      for (const k of packed) all.push(k, ...sc.desc(k))
      for (const k of all) seen.add(k.id)
      out.push({ type: 'ensemble', parent: s, sessions: all, depth: depth + 1 })
    }
  }
  for (const s of roots(sc.world, true)) add(s, 0)
  return out
}

/* ---- the fleet over the same axis ---- */

const STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY]

/** The smallest round interval that is at least `minPx` wide when `span` fills `width`. */
export function step(span: number, width: number, minPx: number): number {
  const want = (span / Math.max(1, width)) * minPx
  return STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1]
}

export interface Fleet {
  first: number
  n: number
  step: number
  total: Float64Array
  picked: Float64Array
  accounts: Record<string, Float64Array>
}

/** Tokens per interval between `from` and `to`: every session, each account, and the sessions
 *  in `pick` (the selected line and its tree). An estimate: see the head of this file. */
export function fleet(sc: Score, from: number, to: number, stepMs: number, pick: ReadonlySet<string> | null): Fleet {
  const first = Math.floor(from / stepMs)
  const n = Math.max(1, Math.ceil(to / stepMs) - first)
  const total = new Float64Array(n)
  const picked = new Float64Array(n)
  const accounts: Record<string, Float64Array> = {}
  for (const a of sc.world.accounts) accounts[a.id] = new Float64Array(n)
  for (const s of sc.world.sessions) {
    const d = sc.line(s)
    if (!d.own || d.t0 == null || d.t1 == null || d.t1 < from || d.t0 > to) continue
    const acct = accounts[s.account]
    const isPicked = !!pick?.has(s.id)
    const put = (t: number, tokens: number) => {
      const i = Math.floor(t / stepMs) - first
      if (i < 0 || i >= n) return
      total[i] += tokens
      if (acct) acct[i] += tokens
      if (isPicked) picked[i] += tokens
    }
    if (d.weight) for (const p of d.series) put(p[0], (d.own * Math.max(0, p[1])) / d.weight)
    else put(d.t1, d.own)
  }
  return { first, n, step: stepMs, total, picked, accounts }
}

/** The sessions that spent the most inside one interval, most first. */
export function spenders(sc: Score, from: number, to: number): { s: Session; tokens: number }[] {
  const list: { s: Session; tokens: number }[] = []
  for (const s of sc.world.sessions) {
    const d = sc.line(s)
    if (!d.own || !d.weight || d.t0 == null || d.t1 == null || d.t1 < from || d.t0 > to) continue
    let tokens = 0
    for (const p of d.series) if (p[0] >= from && p[0] < to) tokens += (d.own * Math.max(0, p[1])) / d.weight
    if (tokens > 0) list.push({ s, tokens })
  }
  return list.sort((a, b) => b.tokens - a.tokens)
}

/** A plan window on the axis. Only its reset is known, so its start is the reset minus the
 *  window's length (5 hours, or 7 days). */
export function planWindow(limit: PlanLimit): { from: number; to: number } | null {
  if (limit.resetsAt == null) return null
  const length = limit.kind === 'session' ? 5 * HOUR : 7 * DAY
  return { from: limit.resetsAt - length, to: limit.resetsAt }
}

/** How far back the axis may be taken: two days, or the oldest line of the last sixty. */
export function earliest(sc: Score): number {
  let at = sc.now - 48 * HOUR
  for (const s of sc.world.sessions) {
    const t0 = sc.line(s).t0
    if (t0 != null && t0 > sc.now - 60 * DAY && t0 < at) at = t0
  }
  return at
}

export interface Tick {
  t: number
  major: boolean
  day: boolean
}

/** The ruler's ticks between `from` and `to`, on local clock times. */
export function ticks(from: number, to: number, width: number): Tick[] {
  const span = to - from
  const major = step(span, width, 120)
  const minor = [MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, DAY].find((m) => m < major && major % m === 0 && (m / span) * width >= 12) ?? major
  const offset = new Date(from).getTimezoneOffset() * MIN
  const list: Tick[] = []
  for (let t = Math.ceil((from - offset) / minor) * minor + offset; t <= to; t += minor) {
    const local = t - offset
    list.push({ t, major: local % major === 0, day: local % DAY === 0 })
  }
  return list
}

/* ---- words ---- */

const two = (n: number) => String(n).padStart(2, '0')
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const fmt = {
  clock(t: number): string {
    const d = new Date(t)
    return two(d.getHours()) + ':' + two(d.getMinutes())
  },
  clockS(t: number): string {
    return fmt.clock(t) + ':' + two(new Date(t).getSeconds())
  },
  day(t: number): string {
    const d = new Date(t)
    return WEEKDAY[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH[d.getMonth()]
  },
  /** "18:55" today, "Sun 21:40" on another day. */
  when(t: number, now: number): string {
    const same = new Date(t).toDateString() === new Date(now).toDateString()
    return same ? fmt.clock(t) : WEEKDAY[new Date(t).getDay()] + ' ' + fmt.clock(t)
  },
  /** A length of time: "40s", "14m", "2h 20m", "3d 4h". */
  span(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000))
    if (s < 90) return s + 's'
    const m = Math.round(s / 60)
    if (m < 90) return m + 'm'
    const h = Math.floor(m / 60)
    if (h < 48) return h + 'h' + (m % 60 && h < 10 ? ' ' + (m % 60) + 'm' : '')
    const d = Math.floor(h / 24)
    return d + 'd' + (h % 24 && d < 10 ? ' ' + (h % 24) + 'h' : '')
  },
  took(ms: number | null): string {
    if (ms == null) return ''
    return ms < 1000 ? Math.round(ms) + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : fmt.span(ms)
  },
  /** The last parts of a path: enough to tell files apart in a narrow place. */
  tail(path: string, parts = 2): string {
    const bits = path.split(/[\\/]/).filter(Boolean)
    return bits.length <= parts ? path : '…/' + bits.slice(-parts).join('/')
  },
}

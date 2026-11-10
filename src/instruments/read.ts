// What each instrument says of a session at a moment, worked out from the world and nothing
// else. Pure: the components in this folder draw what these return, and the tests read them.
//
// "At a moment": with `at` in the past a reading counts only what had happened by then, and
// every item carries `later` so the drawing can dim what had not. The world keeps no history
// of spend, so a past moment's spend is an estimate (`spentShare`) and is drawn as one.

import { sum } from '../world/format'
import { childrenOf, rootOf } from '../world/store'
import type { Account, PullRequest, Session, TokenRow, World } from '../world/types'

/** The moment a reading is of. `past`: before the world's own now. */
export interface Moment {
  t: number
  now: number
  past: boolean
}

export function momentOf(world: World, at: number | null | undefined): Moment {
  const past = at != null && at < world.at
  return { t: past ? at : world.at, now: world.at, past }
}

/** Something with a time, and whether it had not happened yet at the moment read. */
export type Timed<T> = T & { later: boolean }

const timed = <T>(m: Moment, item: T, at: number | null | undefined): Timed<T> => ({ ...item, later: m.past && at != null && at > m.t })
/** A list in the order it is read: newest first. At a past moment what had happened comes
 *  first, newest first, and what had not follows it, soonest first: the latest thing as of
 *  then is on top, and what comes next is right under what has been. */
const inOrder = <T extends { at: number }>(m: Moment, list: T[]): Timed<T>[] =>
  list.map((x) => timed(m, x, x.at)).sort((a, b) => Number(a.later) - Number(b.later) || (a.later ? a.at - b.at : b.at - a.at))
const happened = <T extends { later: boolean }>(list: T[]): number => list.filter((x) => !x.later).length

// ───────────────────────────── words ─────────────────────────────

/** "36m ago" now; "36m before" and "8m later" around a past moment. */
export function when(at: number | null | undefined, m: Moment): string {
  if (at == null) return ''
  if (!m.past) return span(m.now - at) + ' ago'
  return at > m.t ? span(at - m.t) + ' later' : span(m.t - at) + ' before'
}

/** A length of time in one unit: "40s", "4m", "2h", "3d". */
export function span(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 90) return Math.round(s) + 's'
  if (s < 5400) return Math.round(s / 60) + 'm'
  if (s < 129600) return Math.round(s / 3600) + 'h'
  return Math.round(s / 86400) + 'd'
}

/** A duration a tool or the API took: "320ms", "9.1s", "4m 05s", "1h 22m". */
export function took(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's'
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0') + 's'
  return Math.floor(ms / 3600000) + 'h ' + String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0') + 'm'
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return ''
  return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' kB' : (n / 1048576).toFixed(1) + ' MB'
}

/** "claude-opus-5-5" → "opus 5.5"; a dated or 1M-context id loses its suffix. */
export function modelName(id: string | null | undefined): string {
  return String(id ?? '')
    .replace(/^claude-/, '')
    .replace(/\[1m\]$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-(\d+)$/, ' $1')
}

export function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export const bare = (url: string | null | undefined): string => String(url ?? '').replace(/^https?:\/\//, '')

/** A path as the two folders above its file, and the file: the name is what is read. */
export function splitPath(path: string): { dir: string; base: string } {
  const parts = path.replace(/\\/g, '/').split('/')
  const base = parts.pop() ?? ''
  const dir = parts.slice(-2).join('/')
  return { dir: dir ? (parts.length > 2 ? '…/' : '') + dir + '/' : '', base }
}

/** "resets in 2h 20m", against the world's now. */
export function until(resetsAt: number | null, now: number): string {
  if (resetsAt == null) return ''
  const m = Math.round((resetsAt - now) / 60000)
  if (m <= 0) return 'reset due'
  if (m < 60) return `resets in ${m}m`
  if (m < 2880) return `resets in ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
  return `resets in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}

const REASON: Record<string, string> = {
  judge_none_relevant: 'the judge found none relevant',
  notice_below_bar: 'below the bar to speak',
  deduped: 'already given, deduplicated',
  below_min_tokens: 'prompt under the minimum length',
  session_cap_reached: 'session cap reached',
  no_term_match: 'no term matched',
  absolute_floor_fail: 'under the absolute floor',
}

/** Why mnemo kept a rule to itself, in words; a code this table does not know is shown as it came. */
export const reason = (code: string | null | undefined): string => (code ? (REASON[code] ?? code.replace(/_/g, ' ')) : 'no reason recorded')

const LIMIT: Record<string, string> = { session: '5-hour window', weekly_all: 'Week, all models', weekly_scoped: 'Week', credits: 'Credits' }

export const limitName = (kind: string, model: string | null): string => (LIMIT[kind] ?? kind.replace(/_/g, ' ')) + (kind === 'weekly_scoped' && model ? `, ${model}` : '')

// ───────────────────────────── context and tokens ─────────────────────────────

/** Context tokens at a moment: the last call's size, held until the next one. Null before
 *  the first call measured. */
export function contextAt(session: Session, m: Moment): number | null {
  if (!m.past) return session.context.tokens
  let hit: number | null = null
  for (const [t, n] of session.context.series) {
    if (t > m.t) break
    hit = n
  }
  return hit
}

/** The share of a session's spend that had happened by a moment, 0 to 1. Each call costs
 *  about the context it carried, so the share is the context summed over the calls so far
 *  against the context summed over all of them; without a series, the share of its life. */
export function spentShare(session: Session, m: Moment): number {
  if (!m.past) return 1
  const series = session.context.series
  let all = 0
  let before = 0
  for (const [t, n] of series) {
    all += n
    if (t <= m.t) before += n
  }
  if (all > 0) return before / all
  const from = session.startedAt
  const to = session.lastAt
  if (from == null || to == null || to <= from) return m.t >= (to ?? from ?? Infinity) ? 1 : 0
  return Math.max(0, Math.min(1, (m.t - from) / (to - from)))
}

export interface KindRow {
  label: string
  value: number
  /** Of output: how much was thinking. */
  thinking?: number
}

export interface TreeRow {
  session: Session
  depth: number
  own: number
  /** Its share of the tree's spend, 0 to 1. */
  share: number
  selected: boolean
}

export interface ContextReading {
  /** Null: no call measured (yet, at a past moment). */
  tokens: number | null
  window: number
  percent: number | null
  free: number | null
  /** Nearly full: 80% or more. */
  hot: boolean
  /** The session had not started at the moment read. */
  unborn: boolean
  series: [number, number][]
  /** Where the moment falls on the series' span, 0 to 1; null when it is now. */
  cursor: number | null
  compactions: Timed<{ at: number; pre: number; post: number; trigger: string | null }>[]
  /** The last compaction that had happened, and how many came after the moment. */
  lastCompaction: { at: number; pre: number; post: number; trigger: string | null } | null
  compactionsLater: number
  /** 1 now; under 1 at a past moment, when every spend below is an estimate. */
  share: number
  spent: number
  main: number
  sidechain: number
  subagentsSpent: number
  kinds: KindRow[]
  subagents: { id: string; name: string; type: string | null; model: string; calls: number; spent: number }[]
  models: { name: string; spent: number }[]
  cost: Session['cost']
  treeSpent: number
  tree: TreeRow[]
  accounts: (Account & { own: boolean })[]
}

function family(world: World, root: Session): { session: Session; depth: number }[] {
  const out: { session: Session; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (s: Session, depth: number) => {
    if (seen.has(s.id) || depth > 8) return
    seen.add(s.id)
    out.push({ session: s, depth })
    for (const c of childrenOf(world, s)) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}

export function contextReading(world: World, session: Session, at?: number | null): ContextReading {
  const m = momentOf(world, at)
  const ctx = session.context
  const unborn = m.past && session.startedAt != null && m.t < session.startedAt
  const tokens = contextAt(session, m)
  const window = ctx.window
  const percent = tokens == null ? null : !m.past && ctx.percent != null ? ctx.percent : window > 0 ? (tokens / window) * 100 : null
  const share = spentShare(session, m)
  const scale = (n: number) => Math.round(n * share)

  const series = ctx.series
  const from = series[0]?.[0] ?? 0
  const to = Math.max(series[series.length - 1]?.[0] ?? 0, from + 1)
  const compactions = ctx.compactions.map((c) => timed(m, c, c.at))
  const done = compactions.filter((c) => !c.later)

  const own: TokenRow = session.totals.own
  const root = rootOf(world, session)
  const members = family(world, root)
  const treeSpent = sum(root.totals.tree)

  return {
    tokens,
    window,
    percent,
    free: tokens == null ? null : Math.max(0, window - tokens),
    hot: percent != null && percent >= 80,
    unborn,
    series,
    cursor: m.past ? Math.max(0, Math.min(1, (m.t - from) / (to - from))) : null,
    compactions,
    lastCompaction: done[done.length - 1] ?? null,
    compactionsLater: compactions.length - done.length,
    share,
    spent: scale(sum(own)),
    main: scale(sum(session.tokens.main)),
    sidechain: scale(sum(session.tokens.sidechain)),
    subagentsSpent: scale(session.tokens.subagents.reduce((n, a) => n + sum(a.tokens), 0)),
    kinds: [
      { label: 'input', value: scale(own.input) },
      { label: 'output', value: scale(own.output), thinking: scale(own.thinking) },
      { label: 'cache read', value: scale(own.cacheRead) },
      { label: 'cache written', value: scale(own.cacheCreation) },
    ],
    subagents: session.tokens.subagents
      .map((a) => ({ id: a.id, name: (a.description || a.agentType || a.id).replace(/\s+/g, ' ').trim(), type: a.agentType, model: modelName(a.model), calls: a.calls, spent: sum(a.tokens) }))
      .sort((a, b) => b.spent - a.spent),
    models: Object.entries(session.tokens.byModel)
      .map(([id, row]) => ({ name: modelName(id), spent: sum(row) }))
      .sort((a, b) => b.spent - a.spent),
    cost: session.cost,
    treeSpent,
    tree: members.map(({ session: s, depth }) => ({ session: s, depth, own: sum(s.totals.own), share: treeSpent > 0 ? sum(s.totals.own) / treeSpent : 0, selected: s.id === session.id })),
    accounts: world.accounts.map((a) => ({ ...a, own: a.id === session.account })).sort((a, b) => Number(b.own) - Number(a.own)),
  }
}

// ───────────────────────────── memory ─────────────────────────────

type Trail = Session['memory']['trail']
type Claude = Session['memory']['claude']

export interface DialMark {
  /** Degrees clockwise from twelve. */
  angle: number
  later: boolean
  /** Given rules only: the judge's score, which sizes the mark. */
  judge?: number | null
}

export interface MemoryReading {
  given: Timed<Trail['injected'][number]>[]
  asked: Timed<Trail['read'][number] & { what: string }>[]
  held: Timed<Trail['considered'][number]>[]
  /** Why it was held back, most frequent first, counted to the moment. */
  reasons: { code: string; words: string; count: number }[]
  instructions: Timed<Claude['instructions'][number]>[]
  briefings: Timed<Trail['briefings'][number]>[]
  touches: Timed<Claude['touches'][number]>[]
  skills: Timed<Claude['skills'][number]>[]
  corrections: Timed<Trail['frictions'][number]>[]
  prompts: number
  /** The headline numbers, counted to the moment. */
  givenCount: number
  askedCount: number
  heldCount: number
  dial: { given: DialMark[]; asked: DialMark[]; held: DialMark[]; hand: number | null }
  vault: { rules: number | null; prompts: number; spoke: number; silent: number }
}

/** The dial turns 330 degrees over the session's life, start at twelve. */
export const DIAL_SWEEP = 330

export function memoryReading(world: World, session: Session, at?: number | null): MemoryReading {
  const m = momentOf(world, at)
  const { trail, claude } = session.memory

  const given = inOrder(m, trail.injected)
  const asked = inOrder(
    m,
    trail.read.map((x) => ({ ...x, what: x.slug || [x.topic, x.query].filter(Boolean).join(' · ') || x.hits.slice(0, 2).join(', ') || x.tool.replace(/_/g, ' ') })),
  )
  const held = inOrder(m, trail.considered)

  const tally = new Map<string, number>()
  for (const h of held) if (!h.later) tally.set(h.reason, (tally.get(h.reason) ?? 0) + 1)
  const reasons = [...tally].map(([code, count]) => ({ code, words: reason(code), count })).sort((a, b) => b.count - a.count || a.words.localeCompare(b.words))

  // The clock: from the first memory event or the session's start, whichever is first, to its
  // last activity. A rule stamped before the session began is placed at its own time.
  const times = [...trail.injected, ...trail.read, ...trail.considered].map((e) => e.at)
  const from = Math.min(...times, session.startedAt ?? world.at, world.at)
  const to = Math.max(...times, session.lastAt ?? from, from + 1)
  const angle = (t: number) => Math.max(0, Math.min(1, (t - from) / (to - from))) * DIAL_SWEEP
  const mark = (x: { at: number; later: boolean }): DialMark => ({ angle: angle(x.at), later: x.later })

  const outcomes = world.vault.outcomes
  const spoke = outcomes.emitted ?? 0
  const silent = Object.entries(outcomes).reduce((n, [k, v]) => (k === 'emitted' ? n : n + v), 0)

  return {
    given,
    asked,
    held,
    reasons,
    instructions: claude.instructions.map((x) => timed(m, x, x.at)),
    briefings: trail.briefings.map((x) => timed(m, x, x.at)),
    touches: inOrder(m, claude.touches),
    skills: inOrder(m, claude.skills),
    corrections: inOrder(m, trail.frictions),
    prompts: trail.prompts,
    givenCount: happened(given),
    askedCount: happened(asked),
    heldCount: happened(held),
    dial: {
      given: given.map((x) => ({ ...mark(x), judge: x.judge })),
      asked: asked.map(mark),
      held: held.map(mark),
      hand: m.past ? angle(m.t) : null,
    },
    vault: { rules: world.vault.rules, prompts: world.vault.prompts, spoke, silent },
  }
}

// ───────────────────────────── sight ─────────────────────────────

type Web = Session['web']

export interface SightReading {
  shots: Timed<Web['shots'][number]>[]
  /** Pages it opened and took no picture of, newest first. */
  pages: Timed<Web['pages'][number]>[]
  searches: Timed<Web['searches'][number]>[]
  fetches: Timed<Web['fetches'][number]>[]
  artifacts: Timed<Web['artifacts'][number]>[]
  prs: Timed<PullRequest>[]
  edited: Timed<Session['files']['edited'][number]>[]
  /** Reads carry no time in the world: they are never dimmed. */
  read: Session['files']['read']
  /** The headline numbers, counted to the moment. */
  webCount: number
  editedCount: number
  prCount: number
}

export function sightReading(world: World, session: Session, at?: number | null): SightReading {
  const m = momentOf(world, at)
  const web = session.web
  const shots = web.shots.map((x) => timed(m, x, x.at))
  const pictured = new Set(web.shots.map((x) => x.url))
  const pages = inOrder(
    m,
    web.pages.filter((p) => !pictured.has(p.url)),
  )
  const searches = inOrder(m, web.searches)
  const fetches = inOrder(m, web.fetches)
  const artifacts = inOrder(m, web.artifacts)
  // The world dates a pull request by the event that opened it; one with no event is not dimmed.
  const opened = new Map<number, number>()
  for (const e of world.events) {
    if (e.session !== session.id || (e.kind !== 'pr-opened' && e.kind !== 'pr-merged')) continue
    const n = Number(e.text.replace(/^#/, ''))
    if (Number.isFinite(n) && !opened.has(n)) opened.set(n, e.at)
  }
  const prs = session.prs.map((p) => timed(m, p, opened.get(p.number)))
  // A file's last edit is the only time the world has for it.
  const edited = session.files.edited.map((x) => timed(m, x, x.lastAt))
  return {
    shots,
    pages,
    searches,
    fetches,
    artifacts,
    prs,
    edited,
    read: session.files.read,
    webCount: happened(shots) + happened(inOrder(m, web.pages)) + happened(searches) + happened(fetches) + happened(artifacts),
    editedCount: happened(edited),
    prCount: happened(prs),
  }
}

// ───────────────────────────── the column ─────────────────────────────

export type Layout = 'one' | 'pair' | 'three'

/** How the three readings share a column `em` wide: one at a time under three headers; all
 *  three, context over sight beside memory (the Console prototype at its widest); or all
 *  three across. */
export function layoutFor(em: number): Layout {
  if (em >= 84) return 'three'
  if (em >= 46) return 'pair'
  return 'one'
}

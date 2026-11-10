// Orbit's model: what the world means in the scene. Nothing here touches the DOM.
//
// Distance from the centre is attention, in four named bands; direction is the project. A
// body is a root session with its family, and it stands in the band of its family's most
// pressing member, so a parent that is working comes into "needs you" when a child asks.

import { sum } from '../world/format'
import { childrenOf, presentSessions, roots, sessionOf } from '../world/store'
import { STATE_ORDER, type Pending, type PendingKind, type Session, type SessionState, type World } from '../world/types'

export type BandId = 'need' | 'working' | 'idle' | 'ended'

export interface Band {
  id: BandId
  name: string
  /** Where the band starts and ends, as a fraction of the rim's radius. */
  lo: number
  hi: number
  /** 0 is the innermost. */
  i: number
}

export const BANDS: readonly Band[] = [
  { id: 'need', name: 'needs you', lo: 0.25, hi: 0.43, i: 0 },
  { id: 'working', name: 'working', lo: 0.43, hi: 0.62, i: 1 },
  { id: 'idle', name: 'your turn', lo: 0.62, hi: 0.845, i: 2 },
  { id: 'ended', name: 'ended', lo: 0.845, hi: 0.985, i: 3 },
]

export const BAND: Record<BandId, Band> = Object.fromEntries(BANDS.map((b) => [b.id, b])) as Record<BandId, Band>

export const KIND_WORD: Record<PendingKind, string> = { question: 'question', permission: 'permission', blocked: 'blocked', merge: 'merge waits', stalled: 'stalled' }
export const KIND_GLYPH: Record<PendingKind, string> = { question: '◆', permission: '◆', blocked: '◆', merge: '▲', stalled: '✕' }
/** The state whose hue a waiting item of this kind carries. */
export const KIND_STATE: Record<PendingKind, SessionState> = { question: 'need', permission: 'need', blocked: 'need', merge: 'ready', stalled: 'stalled' }

/** A question before a block, a stall, a merge: what the label says first. */
const PRESSING: Record<PendingKind, number> = { question: 0, permission: 0, blocked: 1, stalled: 2, merge: 3 }

export interface Body {
  /** The root session's id. */
  id: string
  root: Session
  project: string
  /** The root, then every session under it. */
  family: Session[]
  /** The root's direct children and theirs, most urgent first: the moons. */
  kids: Session[]
  band: BandId
  /** Where it stands inside its band: 0 at the inner edge, 1 at the outer. */
  t: number
  /** Its distance from the centre, as a fraction of the rim's radius. */
  rho: number
  /** What its whole tree spent, in tokens, and that on a log scale from 0 to 1. */
  tree: number
  size: number
  /** What waits in the family, most pressing first. */
  pend: Pending[]
  /** When anything in the family last moved. */
  lastAt: number | null
  /** An ended body the scene has no room to name: a bead on the rim. */
  folded: boolean
}

export interface SceneProject {
  name: string
  /** By start time, so a session keeps its place among its project's rays. */
  bodies: Body[]
  folded: Body[]
}

export interface Scene {
  world: World
  /** The bodies that carry a label. */
  bodies: Body[]
  /** The ended ones past what the scene can name, newest first. */
  folded: Body[]
  projects: SceneProject[]
  /** A session's body: its family's. */
  bodyOf(sessionId: string | null | undefined): Body | undefined
}

/** How many bodies the scene names before the oldest ended ones fold onto the rim. The
 *  prototype laid out eighteen cleanly at every size it was checked at. */
export const NAMED = 18

const HOUR = 3_600_000
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** Where `ms` falls between `lo` and `hi` on a log scale, 0 to 1. */
const logt = (ms: number, lo: number, hi: number) => clamp(Math.log(Math.max(ms, lo) / lo) / Math.log(hi / lo), 0, 1)

function familyOf(world: World, root: Session): Session[] {
  const out: Session[] = []
  const walk = (s: Session, depth: number) => {
    out.push(s)
    if (depth < 8) for (const c of childrenOf(world, s)) if (!out.includes(c)) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}

function bodyFor(world: World, root: Session): Body {
  const family = familyOf(world, root)
  const mine = new Set(family.map((s) => s.id))
  const gaveUp = (p: Pending) => !!sessionOf(world, p.session)?.abandoned
  const pend = world.pending
    .filter((p) => mine.has(p.session))
    .sort((a, b) => (gaveUp(a) ? 9 : PRESSING[a.kind]) - (gaveUp(b) ? 9 : PRESSING[b.kind]) || (b.since ?? 0) - (a.since ?? 0))
  const has = (...states: SessionState[]) => family.some((s) => states.includes(s.state))
  const band: BandId = pend.length || has('need', 'stalled', 'ready') ? 'need' : has('working') ? 'working' : family.some((s) => s.live && s.state !== 'ended') ? 'idle' : 'ended'

  const lastAt = family.reduce<number | null>((best, s) => (s.lastAt != null && (best == null || s.lastAt > best) ? s.lastAt : best), null) ?? root.startedAt
  const quiet = Math.max(0, world.at - (lastAt ?? world.at))
  let t: number
  if (band === 'need') {
    // A fresh request is closest; one mnemo gave up asking about waits at the outer edge.
    const fresh = pend.filter((p) => !gaveUp(p))
    const newest = fresh.reduce((best, p) => Math.max(best, p.since ?? 0), 0)
    t = fresh.length ? logt(Math.max(0, world.at - (newest || world.at)), 60_000, 7 * 24 * HOUR) : pend.length ? 1 : 0.5
  } else if (band === 'working') t = logt(quiet, 20_000, HOUR)
  else if (band === 'idle') t = logt(quiet, 60_000, 48 * HOUR)
  else t = logt(quiet, 600_000, 48 * HOUR)

  const b = BAND[band]
  const tree = sum(root.totals.tree)
  return {
    id: root.id,
    root,
    project: root.project || '–',
    family,
    kids: family.slice(1).sort((x, y) => STATE_ORDER.indexOf(x.state) - STATE_ORDER.indexOf(y.state) || (y.lastAt ?? 0) - (x.lastAt ?? 0)),
    band,
    t,
    rho: b.lo + (0.14 + 0.72 * t) * (b.hi - b.lo),
    tree,
    size: clamp((Math.log10(Math.max(tree, 1)) - 5.3) / (9 - 5.3), 0, 1),
    pend,
    lastAt,
    folded: false,
  }
}

/** The order the projects take round the rim: the one a list remembers, then the world's
 *  (most sessions first) for those it has not seen. A project never changes place because
 *  another gained a session. */
export function pinOrder(names: string[], remembered: string[]): string[] {
  const known = remembered.filter((n, i) => remembered.indexOf(n) === i)
  return [...known, ...names.filter((n) => !known.includes(n))]
}

export function buildScene(world: World, options: { order?: string[]; named?: number } = {}): Scene {
  const all = roots(world).map((r) => bodyFor(world, r))

  // Every body that is not over keeps its name. The ended ones share what room is left,
  // newest first; the rest are beads on the rim, found by typing.
  const cap = options.named ?? NAMED
  const over = all.filter((b) => b.band === 'ended').sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  const room = Math.max(0, cap - (all.length - over.length))
  for (const b of over.slice(room)) b.folded = true
  const bodies = all.filter((b) => !b.folded)
  const folded = over.slice(room)

  const seen = world.projects.map((p) => p.name)
  for (const b of all) if (!seen.includes(b.project)) seen.push(b.project)
  const projects: SceneProject[] = []
  for (const name of pinOrder(seen, options.order ?? [])) {
    const mine = all.filter((b) => b.project === name).sort((a, b) => (a.root.startedAt ?? 0) - (b.root.startedAt ?? 0) || a.id.localeCompare(b.id))
    if (mine.length) projects.push({ name, bodies: mine.filter((b) => !b.folded), folded: mine.filter((b) => b.folded) })
  }

  const byMember = new Map<string, Body>()
  for (const b of all) for (const s of b.family) byMember.set(s.id, b)
  return { world, bodies, folded, projects, bodyOf: (id) => (id ? byMember.get(sessionOf(world, id)?.id ?? id) : undefined) }
}

/** What a session is doing, in its own words: one line. `printed` when a terminal said it. */
export function doing(s: Session): { text: string; printed: boolean } | null {
  if (s.state === 'ended') return null
  if (s.state === 'working') {
    const call = [...s.activity].reverse().find((a) => a.running) ?? s.activity[s.activity.length - 1]
    if (call) return { text: `${call.tool}${call.target ? ' ' + call.target : ''}`, printed: true }
  }
  const text = (s.recap?.text ?? s.said?.text ?? s.detail ?? s.lastPrompt ?? s.intent ?? '').replace(/\s+/g, ' ').trim()
  return text ? { text, printed: false } : null
}

/** A family's children counted by state, most urgent first, the ended ones left out. */
export function familyCounts(kids: Session[]): { state: SessionState; n: number; word: string }[] {
  const WORDS: Record<SessionState, [string, string]> = { need: ['needs you', 'need you'], working: ['working', 'working'], ready: ['ready', 'ready'], stalled: ['stalled', 'stalled'], idle: ['your turn', 'your turn'], ended: ['ended', 'ended'] }
  return STATE_ORDER.filter((state) => state !== 'ended')
    .map((state) => ({ state, n: kids.filter((k) => k.state === state).length }))
    .filter((c) => c.n > 0)
    .map((c) => ({ ...c, word: WORDS[c.state][c.n > 1 ? 1 : 0] }))
}

export interface MemoryEvent {
  key: string
  at: number
  /** injected: mnemo handed the rule over. read: the session asked for it. learned: a new
   *  rule went into the vault. */
  kind: 'injected' | 'read' | 'learned'
  slug: string
  session: string | null
  project: string | null
}

/** Every memory event the world knows of, oldest first: what the vault saw lately and what
 *  the fleet's events recorded, each once. */
export function memoryEvents(world: World): MemoryEvent[] {
  const out = new Map<string, MemoryEvent>()
  const add = (at: number, kind: MemoryEvent['kind'], slug: string, session: string | null, project: string | null) => {
    if (!at || !slug) return
    const key = `${at}|${kind}|${slug}|${session ?? ''}`
    if (!out.has(key)) out.set(key, { key, at, kind, slug, session, project: project ?? sessionOf(world, session)?.project ?? null })
  }
  for (const r of world.vault.recent) add(r.at, r.kind, r.slug, r.sessionId, r.project)
  for (const e of world.events) {
    if (e.kind === 'rule-injected') add(e.at, 'injected', e.text, e.session, null)
    else if (e.kind === 'rule-read') add(e.at, 'read', e.text, e.session, null)
    else if (e.kind === 'learned') add(e.at, 'learned', e.text, e.session, null)
  }
  return [...out.values()].sort((a, b) => a.at - b.at)
}

/** Which of the lattice's nodes a rule leaves from: the same rule, the same node. */
export function nodeFor(slug: string, spines: number): number {
  let h = 2166136261
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619)
  return spines > 0 ? (h >>> 0) % spines : 0
}

/** The words for why mnemo said nothing to a prompt (the outcomes of `vault.outcomes`). */
const REASON: Record<string, string> = {
  emitted: 'spoke: a rule was handed over',
  judge_none_relevant: 'the judge found none relevant',
  notice_below_bar: 'relevance under the bar',
  below_min_tokens: 'the prompt was too short',
  session_cap_reached: 'this session had its share',
  no_term_match: 'no term matched',
  deduped: 'already given in this session',
}
export const reason = (outcome: string): string => REASON[outcome] ?? outcome.replace(/_/g, ' ')

export interface VaultReading {
  rules: number | null
  prompts: number
  spoke: number
  silent: number
  /** Share of the prompts it spoke to, 0 to 100. */
  spokePercent: number
  /** One row per outcome, `emitted` first, then the silences, most frequent first. */
  outcomes: { key: string; words: string; n: number; spoke: boolean }[]
  /** Where memory went lately: rules handed over or asked for, by project. */
  byProject: { name: string; n: number }[]
  /** The rules mnemo reached for most, with who last got each. */
  top: { slug: string; n: number; last: MemoryEvent }[]
  handed: number
  corrections: number
}

/** What the centre shows when it is opened: what the vault holds and what mnemo did. */
export function readVault(world: World): VaultReading {
  const v = world.vault
  const spoke = v.outcomes.emitted ?? 0
  const silences = Object.entries(v.outcomes)
    .filter(([k]) => k !== 'emitted')
    .sort((a, b) => b[1] - a[1])
  const silent = silences.reduce((n, [, x]) => n + x, 0)
  const events = memoryEvents(world)
  const byProject = new Map<string, number>()
  for (const e of events) if (e.kind !== 'learned' && e.project) byProject.set(e.project, (byProject.get(e.project) ?? 0) + 1)
  const used = new Map<string, { slug: string; n: number; last: MemoryEvent }>()
  const handed = events.filter((e) => e.kind === 'injected')
  for (const e of handed) {
    const u = used.get(e.slug)
    if (u) {
      u.n++
      u.last = e
    } else used.set(e.slug, { slug: e.slug, n: 1, last: e })
  }
  return {
    rules: v.rules,
    prompts: v.prompts,
    spoke,
    silent,
    spokePercent: v.prompts ? Math.round((spoke / v.prompts) * 100) : 0,
    outcomes: [{ key: 'emitted', words: reason('emitted'), n: spoke, spoke: true }, ...silences.map(([key, n]) => ({ key, words: reason(key), n, spoke: false }))],
    byProject: [...byProject].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    top: [...used.values()].sort((a, b) => b.n - a.n || b.last.at - a.last.at).slice(0, 8),
    handed: handed.length,
    corrections: world.sessions.reduce((n, s) => n + s.memory.trail.frictions.length, 0),
  }
}

/** The sessions whose title, project, branch or id has every word of `query`: a title that
 *  starts with it first, then one that contains it, each most urgent first. */
export function findSessions(world: World, query: string): Session[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return presentSessions(world)
    .map((s) => {
      const hay = [s.title, s.project, s.short, s.branch].filter(Boolean).join(' ').toLowerCase()
      if (!words.every((w) => hay.includes(w))) return null
      const title = s.title.toLowerCase()
      return { s, score: (title.startsWith(words[0]) ? 0 : title.includes(words[0]) ? 1 : 2) * 10 + STATE_ORDER.indexOf(s.state) }
    })
    .filter((x): x is { s: Session; score: number } => !!x)
    .sort((a, b) => a.score - b.score || (b.s.lastAt ?? 0) - (a.s.lastAt ?? 0))
    .map((x) => x.s)
}

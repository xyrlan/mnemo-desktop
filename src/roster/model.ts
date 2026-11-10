// What the roster shows, worked out from the world with no DOM: the order, the bands, which
// entries are whole and which are folded at each density, and the one line that says what a
// session is doing. `index.tsx` draws exactly this.

import { WORD } from '../world/format'
import { childrenOf, pendingOf, rootOf, roots, rosterOrder, urgency } from '../world/store'
import { STATE_ORDER, type Session, type SessionState, type World } from '../world/types'

/** attention: the bands, most urgent first. project: the same order inside each project. */
export type Group = 'attention' | 'project'

/** How tightly the roster is drawn. 0: as designed. 1: quiet entries on two rows. 2: every
 *  entry not on stage on two rows. 3: ended sessions gathered into one line, and the ended
 *  children of the family on stage behind their count. */
export type Density = 0 | 1 | 2 | 3

/** 0 waiting for you, 1 working, 2 your turn, 3 ended. */
export type Band = 0 | 1 | 2 | 3
export const BANDS: readonly string[] = ['Waiting for you', 'Working', 'Your turn', 'Ended']

const BAND_OF: Record<SessionState, Band> = { need: 0, stalled: 0, ready: 0, working: 1, idle: 2, ended: 3 }

/** A family's band: where its most urgent member puts it. */
export const bandOf = (world: World, root: Session): Band => BAND_OF[STATE_ORDER[urgency(world, root)] ?? 'ended']

/** The roots in the order the roster lists them. By project, the projects come as the world
 *  has them (most sessions first), a session with no project last, and attention orders the
 *  roots inside each. */
export function rootsIn(world: World, group: Group): Session[] {
  const list = roots(world)
  if (group === 'attention') return list
  const place = new Map(world.projects.map((p, i) => [p.name, i]))
  const at = (s: Session) => (s.project == null ? 1e9 : (place.get(s.project) ?? 1e8))
  return list.sort((a, b) => at(a) - at(b) || String(a.project).localeCompare(String(b.project)))
}

/** Every session the roster shows, top to bottom: each root, then its children. By attention
 *  it is `rosterOrder`. */
export function shownOrder(world: World, group: Group = 'attention'): Session[] {
  if (group === 'attention') return rosterOrder(world)
  return rootsIn(world, group).flatMap((r) => [r, ...childrenOf(world, r)])
}

const marks = new WeakMap<World, Map<string, string>>()

/** A three-letter mark per project, unique in the world: `atlas-api` is ATL, and a second
 *  project that would also be ATL takes its next free letters. */
export function projectMarks(world: World): Map<string, string> {
  const known = marks.get(world)
  if (known) return known
  const names = world.projects.map((p) => p.name)
  for (const s of world.sessions) if (s.project && !names.includes(s.project)) names.push(s.project)
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const name of names) {
    const parts = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
    const flat = parts.join('')
    const tries = [flat.slice(0, 3)]
    if (parts.length > 1) tries.push(parts[0].slice(0, 2) + parts[1][0], parts[0][0] + parts[1].slice(0, 2))
    for (let i = 3; i < flat.length; i++) tries.push(flat.slice(0, 2) + flat[i])
    for (let i = 2; i < 99; i++) tries.push(flat.slice(0, 2) + i)
    const mark = tries.find((t) => t && !used.has(t)) ?? flat.slice(0, 3)
    out.set(name, mark)
    used.add(mark)
  }
  marks.set(world, out)
  return out
}

/** The state's word, or the more exact one the session earned. */
export function wordOf(s: Session): string {
  if (s.state === 'need' && s.abandoned) return 'gave up waiting'
  if (s.state === 'ended' && !s.live && s.prs.some((p) => p.state === 'merged')) return 'merged'
  return WORD[s.state]
}

/** The one line that says what a session is doing. `tool` is set when the line is a call. */
export interface Now {
  kind: 'running' | 'recap' | 'status' | 'said' | 'asked to' | 'last' | 'prompt'
  tool: string | null
  text: string
}

const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/** The running tool, else the session's own recap, else (a child) what mnemo says of it, else
 *  what it last said, what it was asked to do, its last call, the last prompt. */
export function nowOf(s: Session): Now | null {
  for (let i = s.activity.length - 1; i >= 0; i--) {
    const call = s.activity[i]
    if (call.running) return { kind: 'running', tool: call.tool, text: clean(call.target) }
  }
  const say = (kind: Now['kind'], text: string | null | undefined): Now | null => (clean(text) ? { kind, tool: null, text: clean(text) } : null)
  const last = s.activity[s.activity.length - 1]
  return (
    say('recap', s.recap?.text) ??
    (s.role === 'child' ? say('status', s.needs || s.detail) : null) ??
    say('said', s.said?.text) ??
    say('asked to', s.intent) ??
    (last ? { kind: 'last', tool: last.tool, text: clean(last.target) } : null) ??
    say('prompt', s.lastPrompt)
  )
}

export type Block =
  /** A heading: a band of attention, or a project (`project` is its name, when it has one).
   *  `waiting` is what waits in the whole fleet, on the first band only. */
  | { kind: 'band'; key: string; label: string; mark: string | null; band: Band | null; count: number; waiting: number; project?: string }
  /** A root, whole. `tight`: on two rows. `kids`: the children drawn under it. `hidden`: its
   *  ended children kept behind their count. `on`: its family is on stage. */
  | { kind: 'entry'; root: Session; band: Band; on: boolean; tight: boolean; kids: Session[]; hidden: number }
  /** An ended root, on one line. */
  | { kind: 'fold'; root: Session }
  /** Several ended roots, on one line between them. */
  | { kind: 'heap'; roots: Session[] }

export interface PlanOptions {
  /** The session on stage. */
  here?: Session | null
  group?: Group
  density?: Density
  /** Roots given their third row back, by id. */
  roomy?: ReadonlySet<string>
}

/** The roster, top to bottom, as blocks. */
export function plan(world: World, { here = null, group = 'attention', density = 0, roomy }: PlanOptions = {}): Block[] {
  const list = rootsIn(world, group)
  const band = new Map(list.map((r) => [r.id, bandOf(world, r)]))
  const stage = here ? rootOf(world, here) : null
  const marksOf = projectMarks(world)
  const heap = density >= 3 && group === 'attention' ? list.filter((r) => band.get(r.id) === 3 && r !== stage) : []
  const out: Block[] = []
  let last: string | null = null
  for (const root of list) {
    const b = band.get(root.id) as Band
    const key = group === 'project' ? `project:${root.project ?? ''}` : `band:${b}`
    if (key !== last) {
      last = key
      if (group === 'project') {
        out.push({ kind: 'band', key, label: root.project ?? 'No project', mark: (root.project && marksOf.get(root.project)) || null, band: null, count: list.filter((r) => r.project === root.project).length, waiting: 0, ...(root.project ? { project: root.project } : null) })
      } else {
        out.push({ kind: 'band', key, label: BANDS[b], mark: null, band: b, count: list.filter((r) => band.get(r.id) === b).length, waiting: b === 0 ? world.pending.length : 0 })
      }
    }
    if (heap.length > 1 && heap.includes(root)) {
      if (heap[0] === root) out.push({ kind: 'heap', roots: heap })
      continue
    }
    const on = root === stage
    if (root.state === 'ended' && b === 3 && !on) {
      out.push({ kind: 'fold', root })
      continue
    }
    const all = childrenOf(world, root)
    const kids = all.filter((c) => (on && density < 3) || c === here || c.state !== 'ended' || pendingOf(world, c.id).length > 0)
    const tight = !on && !roomy?.has(root.id) && (density >= 2 || (density >= 1 && b === 2))
    out.push({ kind: 'entry', root, band: b, on, tight, kids, hidden: all.length - kids.length })
  }
  return out
}

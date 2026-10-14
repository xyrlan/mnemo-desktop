import { norm, within } from '../path/path'
import type { PulseEvent, PulseKind } from '../pulse/types'
import type { Packet, PacketKind, PacketPath, Territory, World } from './types'

/** Events for one agent within one window of this many ms become one packet (spec Q23). The
 *  windows are fixed slices of the clock, not counted from an event, so a packet's id never
 *  depends on which older events the pulse log still holds. */
export const COALESCE_MS = 5_000

/** A packet whose newest event is older than this is left out: opening the drawer plays the
 *  last few seconds of memory, not the whole log. */
export const PACKET_TTL_MS = 30_000

/** Spec Q22. `enforce` (none on record) and `dispatch` (a child spawning, drawn as a robot
 *  warping in) carry no packet. */
const KINDS: Partial<Record<PulseKind, { kind: PacketKind; path: PacketPath }>> = {
  catchup: { kind: 'catchup', path: 'to-agent' },
  reflex: { kind: 'reflex', path: 'to-agent' },
  tool: { kind: 'read', path: 'round-trip' },
  enrich: { kind: 'enrich', path: 'to-agent' },
  friction: { kind: 'friction', path: 'to-archive' },
  briefing: { kind: 'briefing', path: 'to-archive' },
  learned: { kind: 'learned', path: 'flash' },
}

/** The kinds whose slugs mnemo put in front of the agent, for `injectedRules`. A `tool` row's
 *  slugs are what the agent asked for, not what it was given. */
const INJECTED: ReadonlySet<PulseKind> = new Set(['reflex', 'catchup', 'enrich'])

/** The enrichment log names the file an Edit/Write/Read touched (`file_path`). The pulse does
 *  not forward it yet; once it does, an `enrich` reaches the robot whose worktree holds it. */
type WithFile = PulseEvent & { file_path?: string }

type Agent = { kind: 'robot' | 'nexus'; id: string; root: string }

type Index = {
  bySession: Map<string, Agent>
  /** Robots by worktree, deepest first, so a nested worktree wins over its parent folder. */
  worktrees: { cwd: string; agent: Agent }[]
  byProject: Map<string, Territory>
}

function index(world: World): Index {
  const bySession = new Map<string, Agent>()
  const worktrees: Index['worktrees'] = []
  const byProject = new Map<string, Territory>()
  for (const t of world.territories) {
    if (!byProject.has(t.archive.project)) byProject.set(t.archive.project, t)
    for (const n of t.nexuses) {
      if (!bySession.has(n.sessionId)) bySession.set(n.sessionId, { kind: 'nexus', id: n.sessionId, root: t.root })
      for (const r of n.robots) {
        const agent: Agent = { kind: 'robot', id: r.id, root: t.root }
        const session = r.sessionId ?? r.child.session_id
        // A robot's own session wins over a nexus that happens to share it.
        if (session && bySession.get(session)?.kind !== 'robot') bySession.set(session, agent)
        if (r.child.cwd) worktrees.push({ cwd: norm(r.child.cwd), agent })
      }
    }
  }
  worktrees.sort((a, b) => b.cwd.length - a.cwd.length)
  return { bySession, worktrees, byProject }
}

/** Who an event is for (spec Q22): its session names a robot or nexus; an `enrich` goes by the
 *  worktree holding its file and only ever to a robot; `learned` is the project's alone. */
function attribute(e: WithFile, ix: Index): Agent | null {
  if (e.kind === 'learned') return null
  if (e.kind === 'enrich') {
    if (!e.file_path) return null
    return ix.worktrees.find((w) => within(e.file_path!, w.cwd))?.agent ?? null
  }
  return (e.session_id && ix.bySession.get(e.session_id)) || null
}

function addSlugs(into: string[], slugs: string[]) {
  for (const s of slugs) if (!into.includes(s)) into.push(s)
}

/** mnemo's memory events as packets between archives and agents (spec Q22, Q23): attributed to a
 *  robot or nexus by `session_id` (or, for `enrich`, by the file's worktree), coalesced per agent.
 *  Pure, and the same event keeps the same packet id across calls.
 *
 *  An event no agent can be named for flashes its project's archive. One whose project has no
 *  territory in the world is not drawn. Oldest first. */
export function packetsFrom(events: PulseEvent[], world: World, now: number): Packet[] {
  const ix = index(world)
  const out = new Map<string, Packet & { last: number }>()
  for (const e of events as WithFile[]) {
    const how = KINDS[e.kind]
    if (!how) continue
    const agent = attribute(e, ix)
    const root = agent?.root ?? ix.byProject.get(e.project)?.root
    if (root === undefined) continue
    // To or from an agent, else only the archive glows.
    const path: PacketPath = agent ? how.path : 'flash'
    const window = Math.floor(e.at / COALESCE_MS)
    // One packet per agent, kind and window: a kind keeps its own direction.
    const id = `${how.kind}:${agent ? `${agent.kind}:${agent.id}` : `archive:${root}`}:${window}`
    const prior = out.get(id)
    if (prior) {
      prior.count += 1
      prior.at = Math.min(prior.at, e.at)
      prior.last = Math.max(prior.last, e.at)
      addSlugs(prior.slugs, e.slugs)
    } else {
      const slugs: string[] = []
      addSlugs(slugs, e.slugs)
      out.set(id, { id, kind: how.kind, path, agent: agent && { kind: agent.kind, id: agent.id }, root, count: 1, slugs, at: e.at, last: e.at })
    }
  }
  return [...out.values()]
    .filter((p) => now - p.last <= PACKET_TTL_MS)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ last: _, ...p }) => p)
}

/** The rule slugs mnemo put in front of `sessionId`'s agent, newest first, without repeats: what
 *  the hover card lists. Injected means a reflex, the session-start catchup or an enrichment; the
 *  rules a search returned are not counted. */
export function injectedRules(events: PulseEvent[], sessionId: string): string[] {
  const mine = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.session_id === sessionId && INJECTED.has(e.kind))
    // Newest first; of two at one time, the one logged later.
    .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
  const out: string[] = []
  for (const { e } of mine) addSlugs(out, e.slugs)
  return out
}

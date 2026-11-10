// Keeps the live world current. It listens to what the app already holds (the mission
// snapshot and its poll, the fleet with its hook events, the accounts, mnemo's pulse, the
// terminals the app runs), asks the core for the rest every few seconds (the feed, the
// insight, the trail, the vault's pulse), and builds a world only when something it read
// changed. Everything it reads from is handed in, so a test drives it without Tauri.

import type { AccountsState, PlanUsage } from '../../accounts/types'
import type { RepoNode } from '../../fleet/types'
import type { InsightAsk, Insights, Trails, VaultPulse } from '../../insight/types'
import type { Snapshot } from '../../mission/types'
import type { AgentView, Feed, FeedAsk } from '../../nexus/ship-types'
import type { PulseEvent } from '../../pulse/types'
import type { World } from '../types'
import { buildWorld } from './build'
import { NO_INPUT, type LiveInput } from './input'
import { KEEP_ENDED_MS, rosterOf } from './roster'
import { share, shareBy } from './share'

/** How often the core is asked what the sessions are doing. */
export const READ_MS = 3_000
/** With nothing read anew, the world's "now" still moves on this often, so ages do and a
 *  session that went quiet crosses its thresholds. */
export const CLOCK_MS = 30_000

/** Something the app holds: its value now, and a call whenever it may have changed. */
export interface Watch<T> {
  get(): T
  subscribe(cb: () => void): () => void
}

export interface LiveSources {
  mission: Watch<Snapshot>
  /** Why the last snapshot could not be read; null when it was. */
  missionError: Watch<string | null>
  fleet: Watch<RepoNode[]>
  accounts: Watch<{ state: AccountsState | null; usage: Record<string, { usage: PlanUsage | null; error: string | null }>; error: string | null }>
  pulses: Watch<PulseEvent[]>
  /** The session ids (a child's short id counts) whose terminal the app runs itself. */
  hosted: Watch<string[]>
  /** Where each dialog of several questions is (`./asked.ts`). A source without it has none. */
  asked?: Watch<Record<string, number>>
  feed(asks: FeedAsk[]): Promise<Feed>
  insight(asks: InsightAsk[]): Promise<Insights>
  trails(sessionIds: string[]): Promise<Trails>
  vault(since: number): Promise<VaultPulse>
  now(): number
  /** Runs `tick` every `ms` (and at once unless `wait`), never two at a time, waiting while the
   *  window is hidden: `pollWhileShown`. Returns the way to stop. */
  every(tick: () => unknown, ms: number, opts?: { wait?: boolean }): () => void
}

type Held = Omit<LiveInput, 'now' | 'notes'>

const say = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The fleet's answer per session, as the ship read it. */
function agentsOf(repos: RepoNode[]): Record<string, AgentView> {
  const out: Record<string, AgentView> = {}
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) out[a.sessionId] = { state: a.state, waitingFor: a.waitingFor, title: a.title }
  return out
}

/** The new world out of the old one's objects: a session whose data did not change is the same
 *  object, and a world that says nothing new is the old world itself. `at` is not compared. */
export function shareWorld(prev: World | null, next: World): World {
  if (!prev) return next
  // Sessions and what waits change places as they act: each is matched by its id, never by
  // where it stood, or a session that only moved down the list would be handed over anew.
  const sessions = shareBy(prev.sessions, next.sessions, (s) => s.id)
  const pending = shareBy(prev.pending, next.pending, (p) => p.id)
  const { sessions: _s, pending: _p, at: _at, ...was } = prev
  const { sessions: _ns, pending: _np, at, ...now } = next
  const rest = share(was, now)
  if (sessions === prev.sessions && pending === prev.pending && rest === was) return prev
  return { ...prev, ...rest, sessions, pending, at }
}

/** Start keeping the world current and hand each new one to `set`. Returns how to stop. */
export function createLive(src: LiveSources, set: (world: World) => void): () => void {
  let held: Held = NO_INPUT
  let world: World | null = null
  let stopped = false
  let queued = false
  /** The mission snapshot arrived, or said why it could not: before that there is nothing to say. */
  let began = false
  /** The core was asked once what the sessions are doing. A world built before that would call
   *  a child deep in a long command stalled, for want of knowing the command is running. */
  let fed = false
  let reading = false
  let missionError: string | null = null
  /** Why a read of the core failed, while it does; whether the core wave's commands answer. */
  let feedError: string | null = null
  let insightSilent = false
  let trailSilent = false
  /** Ended sessions whose insight was read after they ended: their transcript will not change. */
  const settled = new Set<string>()

  function notes(): string[] {
    const out: string[] = []
    if (missionError) out.push(`The fleet could not be read: ${missionError}`)
    if (feedError) out.push(`What the sessions are doing could not be read: ${feedError}`)
    if (insightSilent) out.push("Tokens, context and activity are not read yet: this build's core answers no session insight.")
    if (trailSilent) out.push("Memory shows only what the app heard while it ran: this build's core answers no memory trail.")
    return out
  }

  function build() {
    if (stopped || !began || !fed) return
    const now = src.now()
    const kept = shareWorld(world, buildWorld({ ...held, notes: notes(), now }, world))
    if (kept === world) {
      // Nothing new to say: only the clock moved, and it is told at most every `CLOCK_MS`.
      if (now - world.at < CLOCK_MS) return
      world = { ...world, at: now }
    } else world = kept
    set(world)
  }

  /** Several things often change in one turn (a snapshot and the fleet that reads it): one build. */
  function queue() {
    if (queued || stopped) return
    queued = true
    queueMicrotask(() => {
      queued = false
      build()
    })
  }

  function hold<K extends keyof Held>(key: K, value: Held[K]) {
    const kept = share(held[key], value)
    if (kept === held[key]) return
    held = { ...held, [key]: kept }
    queue()
  }

  /** Follows one thing the app holds: taken in now, and each time it may have changed. A store
   *  speaks up for reasons of its own too (a poll began); `hold` keeps what says nothing new out. */
  function follow<T>(watch: Watch<T>, take: (value: T) => void): () => void {
    take(watch.get())
    return watch.subscribe(() => take(watch.get()))
  }

  const offs = [
    follow(src.mission, (snapshot) => {
      // A snapshot never taken (`at` empty) is the store's placeholder, not an empty fleet.
      if (!snapshot.at) return
      hold('snapshot', { repos: snapshot.repos, errors: snapshot.errors })
      begin()
    }),
    follow(src.missionError, (error) => {
      if (error === missionError) return
      missionError = error
      if (error) begin()
      queue()
    }),
    follow(src.fleet, (repos) => {
      hold('agents', agentsOf(repos))
      hold('repos', repos.map((r) => ({ root: r.root, name: r.name })))
    }),
    follow(src.accounts, (accounts) => hold('accounts', accounts)),
    follow(src.pulses, (pulses) => hold('pulses', pulses)),
    follow(src.hosted, (hosted) => hold('hosted', [...hosted].sort())),
    ...(src.asked ? [follow(src.asked, (asked) => hold('asked', asked))] : []),
  ]

  async function read() {
    if (!began || reading || stopped) return
    reading = true
    try {
      await ask()
    } finally {
      reading = false
      if (!fed) {
        fed = true
        queue()
      }
    }
  }

  /** The first snapshot is read about at once, not at the next tick. */
  function begin() {
    if (began) return
    began = true
    void read()
  }

  async function ask() {
    const now = src.now()
    const roster = rosterOf(held.snapshot, held.feed, now)
    const feedAsks: FeedAsk[] = []
    const insightAsks: InsightAsk[] = []
    const ended = new Set<string>()
    for (const { parent: p } of roster.parents) {
      const account = p.account ?? 'default'
      feedAsks.push({ key: p.session_id, sessionId: p.session_id, cwd: p.cwd, account, jobId: null, prUrl: null })
      insightAsks.push({ key: p.session_id, sessionId: p.session_id, cwd: p.cwd, account })
    }
    for (const { child: c, pr } of roster.children) {
      // mnemo does not know its session yet: there is no transcript to read.
      if (!c.session_id) continue
      feedAsks.push({ key: c.id, sessionId: c.session_id, cwd: c.cwd, account: c.account, jobId: c.id, prUrl: pr?.url ?? null })
      if (c.live) settled.delete(c.id)
      else ended.add(c.id)
      if (!settled.has(c.id)) insightAsks.push({ key: c.id, sessionId: c.session_id, cwd: c.cwd, account: c.account })
    }
    for (const g of roster.gone) {
      ended.add(g.sid)
      if (!settled.has(g.sid)) insightAsks.push({ key: g.sid, sessionId: g.sid, cwd: g.repo.root, account: g.account })
    }
    const ids = [...roster.parents.map((s) => s.parent.session_id), ...roster.children.flatMap((s) => (s.child.session_id ? [s.child.session_id] : [])), ...roster.gone.map((g) => g.sid)]

    const [feed, insights, trails, vault] = await Promise.allSettled([
      feedAsks.length ? src.feed(feedAsks) : Promise.resolve(null),
      insightAsks.length ? src.insight(insightAsks) : Promise.resolve(null),
      ids.length ? src.trails(ids) : Promise.resolve(null),
      src.vault(now - KEEP_ENDED_MS),
    ])
    if (stopped) return

    const wasNotes = notes().join('\n')
    if (feed.status === 'fulfilled') {
      feedError = null
      if (feed.value) hold('feed', { sessions: feed.value.sessions, prs: feed.value.prs })
    } else feedError = say(feed.reason)

    if (insights.status === 'fulfilled' && insights.value) {
      const answer = insights.value
      // What was not asked again (an ended session, read once) keeps its answer while it is here.
      const asked = new Set(insightAsks.map((a) => a.key))
      const kept = Object.fromEntries(Object.entries(held.insights).filter(([key]) => ended.has(key) && settled.has(key) && !asked.has(key)))
      for (const key of Object.keys(answer)) if (ended.has(key)) settled.add(key)
      hold('insights', { ...kept, ...answer })
      insightSilent = Object.keys(answer).length === 0 && Object.keys(kept).length === 0
    } else if (insights.status === 'rejected') insightSilent = true

    if (trails.status === 'fulfilled' && trails.value) {
      hold('trails', trails.value)
      trailSilent = Object.keys(trails.value).length === 0
    } else if (trails.status === 'rejected') trailSilent = true

    if (vault.status === 'fulfilled') hold('vault', vault.value)
    if (notes().join('\n') !== wasNotes) queue()
  }

  const stops = [src.every(read, READ_MS), src.every(build, CLOCK_MS, { wait: true })]
  queue()

  return () => {
    stopped = true
    for (const off of [...offs, ...stops]) off()
  }
}

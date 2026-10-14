import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { HomeSnapshot } from '../home/types'
import { pruneSnapshot, type Snapshot } from '../mission/types'
import { advance, buildRepos, eventNext, HOOK_TRUST_MS, keyFor, knownRepos, norm, polledAgents, prIndex, type Tracked } from './model'
import type { AgentEvent, WorktreeInfo } from './upstream'
import type { AgentState, Fleet, WaitingFor } from './types'
import { pollWhileShown, type Shown } from '../shell/while-shown'

/** Everything the fleet reads, injected so tests never touch Tauri (`store.ts` wires the app's). */
export type FleetSources = {
  /** Home's snapshot: the repos the app knows, session titles, open PRs with their checks. */
  home(): HomeSnapshot
  /** The mission snapshot: `claude agents` (interactive sessions) and `mnemo sessions`
   *  (dispatched children), PRs and checks per branch. */
  mission(): Snapshot
  /** The panes shown now, for the pane each session runs in. */
  panes(): Record<number, { id: number; sessionId?: string }>
  /** The worktree whose workbench is shown, which is read as long as it is. */
  shown(): string | null
  listWorktrees(repo: string): Promise<WorktreeInfo[]>
  subscribeAgentEvents(cb: (e: AgentEvent) => void): () => void
  /** Calls `cb` whenever `home`, `mission`, `panes` or `shown` may have changed. */
  onChange(cb: () => void): () => void
  /** Asks for a fresh mission snapshot (with PRs and checks when `withPrs`), and a fresh Home
   *  snapshot when `home`. */
  reload(opts: { withPrs: boolean; home: boolean }): Promise<void>
  now?(): number
}

/** How often the fleet asks its sources again by itself. Hooks carry the news the moment it
 *  happens; this is the fallback when they do not, and it lists worktrees made outside the app. */
export const POLL_MS = 30_000
/** PRs and checks are read through `gh`, a few seconds a repo: every this many polls. */
export const PRS_EVERY = 10

/** An agent a poll saw move without a hook having said so: into `working`, or — what lights its
 *  worktree — into `done` or `needs-you`. Where hooks are heard they move the agent first, so a
 *  poll sees no move; where none are (Windows, a dispatched child anywhere) this is the news.
 *  `child`: a dispatched child; `ask`: what it asks, when mnemo knows. Published once the fleet
 *  shows the move, so the fleet's tree already names the agent and its pane. */
export type PolledMove = {
  sessionId: string
  cwd: string
  child: boolean
  state: AgentState
  waitingFor: WaitingFor
  ask: string | null
  at: number
}

export type FleetHandle = {
  store: StoreApi<Fleet>
  /** Listens to the sources and polls; returns the way to stop. */
  connect(): () => void
  /** Calls `cb` with each `PolledMove` from now on; the first snapshot moves nothing, as the
   *  agents found then were not seen to move. Returns the way to stop. */
  onPolledMove(cb: (m: PolledMove) => void): () => void
}

export function createFleet(src: FleetSources, opts: { pollMs?: number; shown?: Shown } = {}): FleetHandle {
  const now = () => (src.now ? src.now() : Date.now())
  const agents = new Map<string, Tracked>()
  /** Each repo's last listing by root; `[]` when git could not list it and nothing came before. */
  const worktrees = new Map<string, WorktreeInfo[]>()
  const listing = new Set<string>()
  const readAt = new Map<string, number>()
  let lastPoll: Snapshot | null = null
  const watchers = new Set<(m: PolledMove) => void>()
  let moves: PolledMove[] = []

  const trusted = (a: Tracked | undefined, at: number) => a?.hookAt != null && at - a.hookAt < HOOK_TRUST_MS

  /** A mission snapshot, taken in once: each agent moves to what it says, unless a hook spoke
   *  of it just now, and an agent it no longer lists is gone — unless the read failed. */
  function takePoll(snap: Snapshot, at: number, first: boolean) {
    const listed = new Set<string>()
    for (const p of polledAgents(pruneSnapshot(snap, at))) {
      listed.add(p.key)
      const prev = agents.get(p.key)
      if (prev && trusted(prev, at)) {
        agents.set(p.key, { ...prev, cwd: p.cwd || prev.cwd, name: p.name ?? prev.name })
        continue
      }
      const next = advance(prev, p.next(prev), at, { sessionId: p.key, cwd: p.cwd, name: p.name, hookAt: prev?.hookAt ?? null })
      agents.set(p.key, next)
      const news = next.flaggedAt !== (prev?.flaggedAt ?? null)
      if (first || !(news || (prev && prev.state !== 'working' && next.state === 'working'))) continue
      moves.push({ sessionId: p.key, cwd: next.cwd, child: p.child, state: next.state, waitingFor: next.waitingFor, ask: p.ask, at })
    }
    if (snap.errors.length) return
    for (const [k, a] of agents) if (!listed.has(k) && !trusted(a, at)) agents.delete(k)
  }

  async function list(roots: string[]) {
    await Promise.all(
      roots
        .filter((r) => !listing.has(r))
        .map(async (root) => {
          listing.add(root)
          try {
            worktrees.set(root, await src.listWorktrees(root))
          } catch {
            // Keep the last listing: a card must not blink out because git was busy.
            if (!worktrees.has(root)) worktrees.set(root, [])
          } finally {
            listing.delete(root)
          }
        }),
    )
  }

  function sync() {
    const at = now()
    const mission = src.mission()
    if (mission !== lastPoll && mission.at) {
      const first = lastPoll === null
      lastPoll = mission
      takePoll(mission, at, first)
    }
    const home = src.home()
    const repos = knownRepos(home, mission)
    const unlisted = repos.filter((r) => !worktrees.has(r.root) && !listing.has(r.root)).map((r) => r.root)
    if (unlisted.length) void list(unlisted).then(sync)
    const shown = src.shown()
    if (shown) readAt.set(norm(shown), at)
    const next = buildRepos({
      // A folder only the mission snapshot names, that git cannot list, is not a repo.
      repos: repos.filter((r) => r.fromHome || !!worktrees.get(r.root)?.length),
      worktrees,
      agents: agents.values(),
      home,
      panes: src.panes(),
      prs: prIndex(mission, home),
      readAt,
    })
    // A mission snapshot lands every few seconds; most change nothing the fleet shows.
    if (JSON.stringify(next) !== JSON.stringify(store.getState().repos)) store.setState({ repos: next })
    const told = moves
    moves = []
    for (const m of told) for (const cb of watchers) cb(m)
  }

  function onEvent(e: AgentEvent) {
    const key = keyFor(agents, e.sessionId)
    const prev = agents.get(key)
    const next = eventNext(e, prev)
    if (next === 'end') agents.delete(key)
    else if (next) agents.set(key, advance(prev, next, e.at, { sessionId: key, cwd: e.cwd || prev?.cwd || '', name: prev?.name ?? null, hookAt: now() }))
    else return
    sync()
  }

  const roots = () => knownRepos(src.home(), src.mission()).map((r) => r.root)

  async function poll(o: { withPrs: boolean; home: boolean }) {
    try {
      await src.reload(o)
    } catch {
      // The sources keep their last snapshot and say why themselves.
    }
    await list(roots())
    sync()
  }

  const store = createZustand<Fleet>(() => ({
    repos: [],
    markRead(path) {
      readAt.set(norm(path), now())
      sync()
    },
    refresh: () => poll({ withPrs: true, home: true }),
  }))

  function connect() {
    const offs = [src.onChange(sync), src.subscribeAgentEvents(onEvent)]
    let tick = 0
    // Hidden, it waits. The agents (and so the notifications) still move: `pollMission`
    // (App.tsx → shell/mission-poll.ts) refreshes the mission snapshot every 3 s, 15 s while
    // hidden, and `sync` takes each one through `onChange`; hooks move them sooner where heard.
    // What this loop adds is the worktree listings, PRs and Home, which nobody sees then.
    const stop = pollWhileShown(
      () => poll({ withPrs: tick++ % PRS_EVERY === 0, home: src.home().repos.length === 0 }),
      opts.pollMs ?? POLL_MS,
      { shown: opts.shown },
    )
    return () => {
      stop()
      offs.forEach((off) => off())
    }
  }

  function onPolledMove(cb: (m: PolledMove) => void) {
    watchers.add(cb)
    return () => void watchers.delete(cb)
  }

  return { store, connect, onPolledMove }
}

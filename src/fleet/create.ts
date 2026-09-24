import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { HomeSnapshot } from '../home/types'
import { pruneSnapshot, type Snapshot } from '../mission/types'
import { advance, buildRepos, eventNext, HOOK_TRUST_MS, keyFor, knownRepos, norm, polledAgents, prIndex, type Tracked } from './model'
import type { AgentEvent, WorktreeInfo } from './upstream'
import type { Fleet } from './types'

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

export type FleetHandle = {
  store: StoreApi<Fleet>
  /** Listens to the sources and polls; returns the way to stop. */
  connect(): () => void
}

export function createFleet(src: FleetSources, opts: { pollMs?: number } = {}): FleetHandle {
  const now = () => (src.now ? src.now() : Date.now())
  const agents = new Map<string, Tracked>()
  /** Each repo's last listing by root; `[]` when git could not list it and nothing came before. */
  const worktrees = new Map<string, WorktreeInfo[]>()
  const listing = new Set<string>()
  const readAt = new Map<string, number>()
  let lastPoll: Snapshot | null = null

  const trusted = (a: Tracked | undefined, at: number) => a?.hookAt != null && at - a.hookAt < HOOK_TRUST_MS

  /** A mission snapshot, taken in once: each agent moves to what it says, unless a hook spoke
   *  of it just now, and an agent it no longer lists is gone — unless the read failed. */
  function takePoll(snap: Snapshot, at: number) {
    const listed = new Set<string>()
    for (const p of polledAgents(pruneSnapshot(snap, at))) {
      listed.add(p.key)
      const prev = agents.get(p.key)
      if (prev && trusted(prev, at)) {
        agents.set(p.key, { ...prev, cwd: p.cwd || prev.cwd, name: p.name ?? prev.name })
        continue
      }
      agents.set(p.key, advance(prev, p.next(prev), at, { sessionId: p.key, cwd: p.cwd, name: p.name, hookAt: prev?.hookAt ?? null }))
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
      lastPoll = mission
      takePoll(mission, at)
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
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const loop = async () => {
      await poll({ withPrs: tick % PRS_EVERY === 0, home: src.home().repos.length === 0 })
      tick++
      if (!stopped) timer = setTimeout(loop, opts.pollMs ?? POLL_MS)
    }
    void loop()
    return () => {
      stopped = true
      clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }

  return { store, connect }
}

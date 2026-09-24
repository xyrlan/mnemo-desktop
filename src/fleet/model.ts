import type { HomeSnapshot } from '../home/types'
import { allChildren, needKind, type ChildSession, type ParentSession, type Pr as MissionPr, type Snapshot } from '../mission/types'
import type { AgentEvent, WorktreeInfo } from './upstream'
import type { AgentNode, AgentState, PrNode, RepoNode, WaitingFor, WorktreeNode } from './types'

/** An agent as the fleet tracks it between reads. `flaggedAt`: when it last went to `done` or
 *  `needs-you`, which is what makes its worktree unread. `hookAt`: when a hook last said
 *  something of it; polling does not overrule a hook younger than `HOOK_TRUST_MS`. */
export type Tracked = {
  sessionId: string
  cwd: string
  state: AgentState
  waitingFor: WaitingFor
  since: number
  flaggedAt: number | null
  hookAt: number | null
  /** What `claude agents` or `mnemo sessions` calls it, for when Home has no title. */
  name: string | null
}

/** A poll may have started before a hook fired and landed after it, carrying the state the hook
 *  just replaced. A snapshot landing within this long of a hook leaves that agent alone. */
export const HOOK_TRUST_MS = 8_000

export type Next = { state: AgentState; waitingFor: WaitingFor }

export const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const base = (p: string) => norm(p).split('/').pop() || p

/** `cwd` is `path` or somewhere under it. */
export const within = (cwd: string, path: string) => {
  const c = norm(cwd)
  const p = norm(path)
  return c === p || c.startsWith(p === '/' ? p : `${p}/`)
}

/** A card's name: the repo's own folder for the main checkout, else the tree's folder without
 *  the `<repo>-wt-` every sibling tree carries (`mnemo dispatch`'s convention, and ours). */
export function worktreeName(info: Pick<WorktreeInfo, 'path' | 'isMain'>, root: string): string {
  const name = base(info.path)
  const prefix = `${base(root)}-wt-`
  return !info.isMain && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name
}

export const worktreeKind = (info: Pick<WorktreeInfo, 'isMain' | 'dispatched'>): WorktreeNode['kind'] =>
  info.isMain ? 'main' : info.dispatched ? 'dispatched' : 'workspace'

const branchName = (b: string | null) => (b ? b.replace(/^refs\/heads\//, '') : null)

/** `claude agents` `waitingFor`, as the kind of answer it wants. Values seen on Claude Code
 *  2.1.281 (`src/conversation/Face.tsx`'s `waitingKind` reads them the same way): `input needed`
 *  for AskUserQuestion, `permission prompt` for a tool or a plan, `sandbox request` for network
 *  access. A snapshot from before `waitingFor` was carried reads as a permission, as it did then. */
function waitingKindOf(waitingFor: string | null | undefined): WaitingFor | 'none' {
  if (waitingFor == null) return 'permission'
  if (waitingFor === 'input needed') return 'question'
  if (waitingFor === 'permission prompt' || waitingFor === 'sandbox request') return 'permission'
  // `/config` and friends: the user opened it, nothing is asked of them.
  if (waitingFor === 'dialog open') return 'none'
  return null
}

/** A finish is only seen by polling as busy (or waiting) and then idle: a session found idle
 *  that was last known doing something went to `done`; one never seen doing anything is `idle`. */
const settled = (prev: AgentState | undefined): AgentState => (prev === undefined || prev === 'idle' ? 'idle' : 'done')

/** An interactive session's state from its `claude agents` row. */
export function parentNext(p: Pick<ParentSession, 'status' | 'waiting_for'>, prev: Tracked | undefined): Next {
  const was = prev?.state
  if (p.status === 'busy') return { state: 'working', waitingFor: null }
  if (p.status === 'waiting') {
    const kind = waitingKindOf(p.waiting_for)
    if (kind === 'none') return prev ? { state: prev.state, waitingFor: prev.waitingFor } : { state: 'idle', waitingFor: null }
    return { state: 'needs-you', waitingFor: kind }
  }
  if (p.status === 'idle') return { state: settled(was), waitingFor: null }
  return prev ? { state: prev.state, waitingFor: prev.waitingFor } : { state: 'idle', waitingFor: null }
}

/** A dispatched child's state from its `mnemo sessions` row, which `claude agents` marks with
 *  what its process is parked on. A child no longer running that never finished is idle. */
export function childNext(c: Pick<ChildSession, 'state' | 'tempo' | 'live' | 'needs' | 'waiting_for'>): Next {
  if (c.state === 'done') return { state: 'done', waitingFor: null }
  if (c.state === 'stopped' || !c.live) return { state: 'idle', waitingFor: null }
  if (c.tempo === 'blocked' || c.waiting_for) return { state: 'needs-you', waitingFor: needKind(c) }
  return { state: 'working', waitingFor: null }
}

/** What a `Notification` hook says: a permission asked, a question asked, or nothing new (the
 *  "waiting for your input" nudge an idle session sends a minute after it stopped, and a login
 *  going through). Reads Claude Code's `notification_type` as well as its message. */
export function notificationKind(message: string | undefined): WaitingFor | 'none' {
  const m = (message ?? '').toLowerCase()
  if (m.includes('permission')) return 'permission'
  if (m.includes('idle') || m.includes('waiting for your input') || m.includes('auth')) return 'none'
  return 'question'
}

/** A hook event's state; `end` when the session is gone, null when it changes nothing. `start`
 *  also fires on `/clear` and on a compaction mid-turn, so it only names a session it did not
 *  know; it never takes a known one back to idle. */
export function eventNext(e: Pick<AgentEvent, 'kind' | 'message'>, prev: Tracked | undefined): Next | 'end' | null {
  switch (e.kind) {
    case 'start':
      return prev ? null : { state: 'idle', waitingFor: null }
    case 'prompt':
      return { state: 'working', waitingFor: null }
    case 'stop':
      return { state: 'done', waitingFor: null }
    case 'notification': {
      const kind = notificationKind(e.message)
      return kind === 'none' ? null : { state: 'needs-you', waitingFor: kind }
    }
    case 'end':
      return 'end'
  }
}

/** `prev` moved to `next` at `at`. A move into `done` or `needs-you` flags the agent; so does
 *  first sight of one already waiting on you. First sight of a finished one does not: every
 *  child that finished before launch would light up. */
export function advance(prev: Tracked | undefined, next: Next, at: number, fields: { sessionId: string; cwd: string; name: string | null; hookAt: number | null }): Tracked {
  const moved = !prev || prev.state !== next.state
  const news = next.state === 'needs-you' ? moved : next.state === 'done' && !!prev && moved
  return {
    ...fields,
    state: next.state,
    waitingFor: next.waitingFor,
    since: moved || !prev ? at : prev.since,
    flaggedAt: news ? at : (prev?.flaggedAt ?? null),
  }
}

/** A dispatched child's key: its session id when mnemo knows it, else its short id (the session
 *  id's first eight characters), which a hook's full id is matched against. */
export const childKey = (c: Pick<ChildSession, 'id' | 'session_id'>) => c.session_id ?? c.id

/** The tracked key a session id belongs to: itself, or the short id a child was keyed by. */
export function keyFor(agents: ReadonlyMap<string, Tracked>, sessionId: string): string {
  if (agents.has(sessionId)) return sessionId
  const short = sessionId.slice(0, 8)
  return agents.has(short) ? short : sessionId
}

export type Polled = { key: string; cwd: string; name: string | null; next: (prev: Tracked | undefined) => Next }

/** Every agent the mission snapshot knows. A session listed both ways is the child. */
export function polledAgents(snap: Snapshot): Polled[] {
  const out = new Map<string, Polled>()
  for (const r of snap.repos)
    for (const p of r.parents) out.set(p.session_id, { key: p.session_id, cwd: p.cwd, name: p.name, next: (prev) => parentNext(p, prev) })
  for (const c of allChildren(snap)) {
    const key = childKey(c)
    out.set(key, { key, cwd: c.cwd, name: c.name ?? c.intent, next: () => childNext(c) })
  }
  return [...out.values()]
}

const fromMissionPr = (p: MissionPr): PrNode => ({
  number: p.number,
  state: p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.draft ? 'draft' : 'open',
  checks: p.ci === 'pass' ? 'passing' : p.ci === 'fail' ? 'failing' : p.ci === 'pending' ? 'pending' : null,
})

const fromHomePr = (p: { number: number; state: 'open' | 'draft'; checks: string }): PrNode => ({
  number: p.number,
  state: p.state,
  checks: p.checks === 'pass' ? 'passing' : p.checks === 'fail' ? 'failing' : p.checks === 'pending' ? 'pending' : null,
})

/** Where a worktree's PR is found: by the tree a child worked in, else by branch within its
 *  repo. The mission snapshot's reading wins, since it knows merged and closed PRs; Home's
 *  (open PRs only, tied to the child that opened them) fills what it lacks. */
export type PrIndex = { byCwd: Map<string, PrNode>; byBranch: Map<string, PrNode> }

const branchKey = (root: string, branch: string) => `${norm(root)}\0${branch}`

export function prIndex(mission: Snapshot, home: HomeSnapshot): PrIndex {
  const byCwd = new Map<string, PrNode>()
  const byBranch = new Map<string, PrNode>()
  const put = (m: Map<string, PrNode>, k: string, pr: PrNode) => void (m.has(k) || m.set(k, pr))
  for (const r of mission.repos) {
    for (const m of r.missions)
      for (const p of m.pieces) {
        const pr = p.pr ?? p.child?.pr
        if (pr) put(byBranch, branchKey(r.root, p.branch), fromMissionPr(pr))
        if (pr && p.child?.cwd) put(byCwd, norm(p.child.cwd), fromMissionPr(pr))
      }
    for (const c of r.children) {
      if (!c.pr) continue
      if (c.cwd) put(byCwd, norm(c.cwd), fromMissionPr(c.pr))
      if (c.branch) put(byBranch, branchKey(r.root, c.branch), fromMissionPr(c.pr))
    }
  }
  for (const r of home.repos)
    for (const pr of r.prs ?? []) {
      const child = pr.child ? r.children.find((s) => s.id.startsWith(pr.child!)) : undefined
      if (child?.cwd) put(byCwd, norm(child.cwd), fromHomePr(pr))
    }
  return { byCwd, byBranch }
}

/** Home's title for a session (what the sidebar names its tab by), else null. */
export function homeTitle(home: HomeSnapshot, sessionId: string): string | null {
  for (const r of home.repos) {
    const s = r.sessions.find((x) => x.id === sessionId) ?? r.children.find((x) => x.id === sessionId || sessionId.startsWith(x.id))
    if (s) return s.title || s.agent || null
  }
  return null
}

const RANK: Record<AgentState, number> = { 'needs-you': 0, working: 1, done: 2, idle: 3 }
const KIND: Record<WorktreeNode['kind'], number> = { main: 0, workspace: 1, dispatched: 1 }

export type BuildInput = {
  /** Every repo, in the order the fleet lists them. */
  repos: Array<{ root: string; name: string }>
  /** Each repo's worktrees by root; a repo without a listing is shown as its main checkout. */
  worktrees: ReadonlyMap<string, WorktreeInfo[]>
  agents: Iterable<Tracked>
  home: HomeSnapshot
  panes: Record<number, { id: number; sessionId?: string }>
  prs: PrIndex
  /** When each worktree, by path, was last shown. */
  readAt: ReadonlyMap<string, number>
}

/** The fleet's tree. An agent goes to the deepest worktree its cwd is in, across every repo, so a
 *  sibling tree is never claimed by the main checkout it sits beside (nor one nested in it); an
 *  agent in no known worktree is left out. */
export function buildRepos(input: BuildInput): RepoNode[] {
  const trees = input.repos.map((r) => {
    const listed = input.worktrees.get(r.root)
    const infos: WorktreeInfo[] = listed?.length
      ? listed
      : [{ path: r.root, branch: null, head: '', isMain: true, dispatched: false, dirty: false, setupJob: null }]
    return { repo: r, infos }
  })
  const all = trees.flatMap((t) => t.infos.map((i) => norm(i.path)))
  const home = (cwd: string) => all.filter((p) => within(cwd, p)).sort((a, b) => b.length - a.length)[0]

  const paneOf = new Map<string, number>()
  for (const p of Object.values(input.panes)) if (p.sessionId) paneOf.set(p.sessionId, p.id)

  const byTree = new Map<string, Tracked[]>()
  for (const a of input.agents) {
    const t = home(a.cwd)
    if (t) byTree.set(t, [...(byTree.get(t) ?? []), a])
  }

  return trees.map(({ repo, infos }) => {
    const seen = new Set<string>()
    const worktrees = infos
      .filter((i) => !seen.has(norm(i.path)) && !!seen.add(norm(i.path)))
      .map((info): WorktreeNode => {
        const path = norm(info.path)
        const branch = branchName(info.branch)
        const tracked = byTree.get(path) ?? []
        const readAt = input.readAt.get(path) ?? -Infinity
        const agents = tracked
          .map(
            (a): AgentNode => ({
              sessionId: a.sessionId,
              paneId: paneOf.get(a.sessionId) ?? [...paneOf].find(([sid]) => sid.startsWith(a.sessionId))?.[1] ?? null,
              state: a.state,
              waitingFor: a.state === 'needs-you' ? a.waitingFor : null,
              title: homeTitle(input.home, a.sessionId) ?? a.name ?? `session ${a.sessionId.slice(0, 8)}`,
              since: a.since,
            }),
          )
          .sort((x, y) => RANK[x.state] - RANK[y.state] || y.since - x.since || x.sessionId.localeCompare(y.sessionId))
        return {
          path,
          name: worktreeName(info, repo.root),
          branch,
          kind: worktreeKind(info),
          agents,
          pr: input.prs.byCwd.get(path) ?? (branch ? input.prs.byBranch.get(branchKey(repo.root, branch)) : undefined) ?? null,
          unread: tracked.some((a) => a.flaggedAt !== null && a.flaggedAt > readAt),
        }
      })
      .sort((a, b) => KIND[a.kind] - KIND[b.kind] || a.name.localeCompare(b.name))
    return { root: norm(repo.root), name: repo.name, worktrees }
  })
}

/** The repos the fleet lists: Home's (its order: pinned, then recent), less the hidden ones and
 *  the unresolved ones — listing those would run git where macOS guards the folder — then any
 *  repo only the mission snapshot knows, because an agent is working in it. */
export function knownRepos(home: HomeSnapshot, mission: Snapshot): Array<{ root: string; name: string; fromHome: boolean }> {
  const out = new Map<string, { root: string; name: string; fromHome: boolean }>()
  for (const r of home.repos) if (!r.hidden && !r.unresolved) out.set(norm(r.root), { root: norm(r.root), name: r.name, fromHome: true })
  const hidden = new Set(home.repos.filter((r) => r.hidden || r.unresolved).map((r) => norm(r.root)))
  const extra = mission.repos
    .filter((r) => !out.has(norm(r.root)) && !hidden.has(norm(r.root)))
    .map((r) => ({ root: norm(r.root), name: r.name, fromHome: false }))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const r of extra) out.set(r.root, r)
  return [...out.values()]
}

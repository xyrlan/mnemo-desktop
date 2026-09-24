import type { AgentState, RepoNode, WorktreeNode } from '../fleet/types'
import { matchWorktree, type FieldRanges } from './search'

/** One row of the jump palette: a worktree of the fleet, with what the row shows and, for a
 *  query, what to highlight. */
export type JumpEntry = {
  path: string
  name: string
  branch: string
  repo: string
  kind: WorktreeNode['kind']
  /** The most pressing state among its agents; null with no agent. */
  state: AgentState | null
  /** Epoch ms its latest agent entered its state, the row's age; null with no agent. */
  lastActiveAt: number | null
  unread: boolean
  ranges: FieldRanges
}

const RANK: Record<AgentState, number> = { 'needs-you': 0, working: 1, done: 2, idle: 3 }

export function worktreeState(w: WorktreeNode): AgentState | null {
  return w.agents.reduce<AgentState | null>((best, a) => (best === null || RANK[a.state] < RANK[best] ? a.state : best), null)
}

/** Every worktree of the fleet a query finds, best first. With no query: the ones with recent
 *  agent activity first, then the rest in the fleet's own order (repo by repo, main first). */
export function jumpEntries(repos: RepoNode[], query: string): JumpEntry[] {
  const rows: { entry: JumpEntry; score: number; order: number }[] = []
  let order = 0
  for (const repo of repos) {
    for (const w of repo.worktrees) {
      const at = order++
      const branch = w.branch ?? ''
      const m = matchWorktree({ name: w.name, branch, repo: repo.name }, query)
      if (!m) continue
      const lastActiveAt = w.agents.length ? Math.max(...w.agents.map((a) => a.since)) : null
      rows.push({
        entry: { path: w.path, name: w.name, branch, repo: repo.name, kind: w.kind, state: worktreeState(w), lastActiveAt, unread: w.unread, ranges: m.ranges },
        score: m.score,
        order: at,
      })
    }
  }
  return rows
    .sort((a, b) => b.score - a.score || (b.entry.lastActiveAt ?? -1) - (a.entry.lastActiveAt ?? -1) || a.order - b.order)
    .map((r) => r.entry)
}

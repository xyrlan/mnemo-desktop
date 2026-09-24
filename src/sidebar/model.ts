import type { AgentNode, AgentState, PrNode, RepoNode, WorktreeNode } from '../fleet/types'
import { accentHue } from '../home/repo-color'

/** A path as the fleet spells it: no trailing slash. */
export const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** A worktree's status lane, from its agents. Orca's `WorktreeStatus` priority
 *  (`lib/worktree-status.ts`): an agent waiting on you wins, then one working, then one done. */
export type WorktreeStatus = 'permission' | 'working' | 'done' | 'inactive'

export function worktreeStatus(agents: readonly Pick<AgentNode, 'state'>[]): WorktreeStatus {
  if (agents.some((a) => a.state === 'needs-you')) return 'permission'
  if (agents.some((a) => a.state === 'working')) return 'working'
  if (agents.some((a) => a.state === 'done')) return 'done'
  return 'inactive'
}

export const STATUS_LABEL: Record<WorktreeStatus, string> = {
  permission: 'Needs you',
  working: 'Working',
  done: 'Done',
  inactive: 'Idle',
}

/** One agent's glyph: Orca's `AgentDotState`, narrowed to what the fleet can tell. */
export type AgentDotState = 'permission' | 'waiting' | 'working' | 'done' | 'idle'

export function agentDot(a: Pick<AgentNode, 'state' | 'waitingFor'>): AgentDotState {
  if (a.state === 'needs-you') return a.waitingFor === 'permission' ? 'permission' : 'waiting'
  return a.state
}

export const DOT_LABEL: Record<AgentDotState, string> = {
  permission: 'Needs permission',
  waiting: 'Waiting for input',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
}

/** Orca's `SUMMARY_STATE_ORDER`: whatever asks for you first, true idle last. */
const DOT_ORDER: AgentDotState[] = ['permission', 'waiting', 'working', 'done', 'idle']

export type SummaryGroup = { state: AgentDotState; count: number }

/** The collapsed pill of a card with several agents: one group per state, attention first. */
export function summaryGroups(agents: readonly AgentNode[]): SummaryGroup[] {
  const counts = new Map<AgentDotState, number>()
  for (const a of agents) counts.set(agentDot(a), (counts.get(agentDot(a)) ?? 0) + 1)
  return DOT_ORDER.flatMap((state) => (counts.has(state) ? [{ state, count: counts.get(state)! }] : []))
}

/** What the pill says to a screen reader: "3 agents: 1 waiting for input, 2 working". */
export function summarize(agents: readonly AgentNode[]): string {
  const subject = `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`
  const parts = summaryGroups(agents).map((g) => `${g.count} ${DOT_LABEL[g.state].toLowerCase()}`)
  return `${subject}: ${parts.join(', ')}`
}

/** Every agent in the fleet, counted by state: the Agent Dashboard entry's numbers. */
export function countByState(repos: readonly RepoNode[]): Record<AgentState, number> {
  const counts: Record<AgentState, number> = { 'needs-you': 0, working: 0, done: 0, idle: 0 }
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) counts[a.state]++
  return counts
}

/** The cards as the sidebar shows them, top to bottom, leaving out folded repos: what
 *  `worktree.go.1` … `worktree.go.9` count. */
export function sidebarOrder(repos: readonly RepoNode[], collapsed: ReadonlySet<string>): WorktreeNode[] {
  return repos.flatMap((r) => (collapsed.has(r.root) ? [] : r.worktrees))
}

/** The card shown as active: the worktree on screen, or, before one is chosen, the main checkout
 *  of the first repo, which is what the shell shows then. */
export function activePath(activeWorktree: string | null, repos: readonly RepoNode[]): string | null {
  if (activeWorktree !== null) return norm(activeWorktree)
  return repos[0]?.worktrees.find((w) => w.kind === 'main')?.path ?? null
}

/** Orca's short age: "now", "5m", "2h", "3d". */
export function shortAgo(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

/** A repo's colour: the hue Home already derives from its path, at a lightness that reads on the
 *  sidebar in both themes. */
export function repoColor(root: string): string {
  return `oklch(0.7 0.13 ${accentHue(root)})`
}

/** Orca's `getReviewStatusLabel`: the state when it is not open, else what the checks say. */
export function prLabel(pr: PrNode): string {
  const label = `PR #${pr.number}`
  if (pr.state === 'merged') return `${label}: Merged`
  if (pr.state === 'closed') return `${label}: Closed`
  if (pr.state === 'draft') return `${label}: Draft`
  if (pr.checks === 'failing') return `${label} checks: Failing`
  if (pr.checks === 'pending') return `${label} checks: Pending`
  if (pr.checks === 'passing') return `${label} checks: Passing`
  return `${label}: Open`
}

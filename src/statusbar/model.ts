import type { Fleet, AgentState } from '../fleet/types'
import type { Pane, Tab } from '../layout/store'
import { barInfo } from '../chrome/info'
import type { Snapshot } from '../mission/types'

export const AGENT_STATES: AgentState[] = ['needs-you', 'working', 'done', 'idle']

export type AgentCounts = Record<AgentState, number>

/** Every agent of every worktree of the fleet, counted by state. */
export function countAgents(repos: Fleet['repos']): AgentCounts {
  const counts: AgentCounts = { 'needs-you': 0, working: 0, done: 0, idle: 0 }
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) counts[a.state]++
  return counts
}

/** The non-zero states, most urgent first, as `2 need you`, `3 working`. */
export function agentSummary(counts: AgentCounts): { state: AgentState; count: number; label: string }[] {
  const label: Record<AgentState, string> = { 'needs-you': 'need you', working: 'working', done: 'done', idle: 'idle' }
  return AGENT_STATES.filter((s) => counts[s] > 0).map((s) => ({ state: s, count: counts[s], label: `${counts[s]} ${label[s]}` }))
}

/** The focused pane of the active tab, if any. */
export function activePane(s: { tabs: Tab[]; activeTab: string; panes: Record<number, Pane> }): { id: number; pane: Pane } | undefined {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  const pane = tab && s.panes[tab.focused]
  return tab && pane ? { id: tab.focused, pane } : undefined
}

/** What the pane bar shows as tokens today, for the active pane. */
export function paneTokens(pane: Pane | undefined, snap: Snapshot): string | undefined {
  return pane ? barInfo(pane, snap).tokens : undefined
}

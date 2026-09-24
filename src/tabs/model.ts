import type { Tab } from '../layout/store'
import { leaves } from '../layout/tree'
import type { AgentNode, RepoNode } from '../fleet/types'

/** Every agent the fleet knows, of every worktree: pane ids are unique across worktrees, so a
 *  tab finds its own by pane alone. */
export function fleetAgents(repos: RepoNode[]): AgentNode[] {
  return repos.flatMap((r) => r.worktrees.flatMap((w) => w.agents))
}

/** Most urgent first: an agent waiting on you outranks one working, which outranks one done. */
const LOUDEST: AgentNode['state'][] = ['needs-you', 'working', 'done', 'idle']

/** The agent a tab's dot speaks for: the loudest of those running in its panes, the newest of
 *  them on a tie. `null` when no pane of the tab runs one. */
export function tabAgent(tab: Tab, agents: AgentNode[]): AgentNode | null {
  const ids = new Set(leaves(tab.root))
  let best: AgentNode | null = null
  for (const a of agents) {
    if (a.paneId === null || !ids.has(a.paneId)) continue
    if (!best) best = a
    else {
      const d = LOUDEST.indexOf(a.state) - LOUDEST.indexOf(best.state)
      if (d < 0 || (d === 0 && a.since > best.since)) best = a
    }
  }
  return best
}

/** Whether a tab carries news you have not looked at: it is not the one shown, and one of its
 *  agents finished or started waiting on you after `seen` (when the tab was last shown). */
export function tabUnread(tab: Tab, agents: AgentNode[], active: boolean, seen: number): boolean {
  if (active) return false
  const ids = new Set(leaves(tab.root))
  return agents.some((a) => a.paneId !== null && ids.has(a.paneId) && (a.state === 'done' || a.state === 'needs-you') && a.since > seen)
}

/** `tabs` with the tab `from` moved to where `to` is, the others keeping their order. The same
 *  array when either is missing or they are one tab. */
export function reorderTabs(tabs: Tab[], from: string, to: string): Tab[] {
  const a = tabs.findIndex((t) => t.id === from)
  const b = tabs.findIndex((t) => t.id === to)
  if (a < 0 || b < 0 || a === b) return tabs
  const next = tabs.slice()
  const [moved] = next.splice(a, 1)
  next.splice(b, 0, moved)
  return next
}

export type DropIndicator = 'left' | 'right' | null

/** Where the insertion bar shows while tab `from` is dragged over tab `over`: on the side of
 *  `over` it will land — its left when coming from the right, its right when coming from the
 *  left. Nothing over itself or outside the strip. */
export function dropIndicatorFor(ids: string[], from: string | null, over: string | null, id: string): DropIndicator {
  if (from === null || over === null || from === over || id !== over) return null
  const a = ids.indexOf(from)
  const b = ids.indexOf(over)
  if (a < 0 || b < 0) return null
  return a > b ? 'left' : 'right'
}

/** The fleet: every repo the app knows, its worktrees, and the agents in each. The one data
 *  source for the left sidebar's worktree cards and the dashboard kanban (wave B); the shapes
 *  are the wave-A contract's (`docs/superpowers/contracts/2026-09-24-orca-redesign-a.md`). */

export type AgentState = 'working' | 'needs-you' | 'done' | 'idle'
export type WaitingFor = 'permission' | 'question' | null

/** `paneId`: the terminal pane running the session, when one of the shown panes does.
 *  `since`: epoch ms the agent entered `state`. */
export type AgentNode = {
  sessionId: string
  paneId: number | null
  state: AgentState
  waitingFor: WaitingFor
  title: string
  since: number
}

export type PrNode = {
  number: number
  state: 'open' | 'draft' | 'merged' | 'closed'
  checks: 'pending' | 'passing' | 'failing' | null
}

/** `unread`: one of its agents went to `done` or `needs-you` since the worktree was last shown. */
export type WorktreeNode = {
  path: string
  name: string
  branch: string | null
  kind: 'main' | 'workspace' | 'dispatched'
  agents: AgentNode[]
  pr: PrNode | null
  unread: boolean
}

export type RepoNode = { root: string; name: string; worktrees: WorktreeNode[] }

export type Fleet = {
  repos: RepoNode[]
  /** The worktree at `path` was shown: its agents' finishes and asks are no longer news. */
  markRead(path: string): void
  /** Ask every source again: the repos, their worktrees, `claude agents`, PRs and checks. */
  refresh(): Promise<void>
}

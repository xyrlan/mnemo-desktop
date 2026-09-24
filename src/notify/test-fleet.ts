import type { RepoNode } from '../fleet/types'

/** A fleet for the tests: two repos, an agent in the main checkout (pane 3) and one in a
 *  dispatched tree under `.claude/worktrees/` (pane 7). */
const agent = (sessionId: string, title = '', paneId: number | null = null) => ({ sessionId, paneId, state: 'working' as const, waitingFor: null, title, since: 0 })
const wt = (path: string, name: string, kind: 'main' | 'workspace' | 'dispatched' = 'workspace', agents: ReturnType<typeof agent>[] = []) => ({ path, name, branch: name, kind, agents, pr: null, unread: false })

export const REPOS: RepoNode[] = [
  {
    root: '/code/app',
    name: 'app',
    worktrees: [wt('/code/app', 'app', 'main', [agent('s-main', 'Fix the build', 3)]), wt('/code/app/.claude/worktrees/feat', 'feat', 'dispatched', [agent('s-feat', 'Add login', 7)])],
  },
  { root: '/code/lib', name: 'lib', worktrees: [wt('/code/lib', 'lib', 'main'), wt('/code/lib-wt', 'lib-wt')] },
]


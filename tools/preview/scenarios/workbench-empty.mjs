// The workbench after a restart, of a worktree with no tab open: its empty state (New terminal /
// Launch agent), and the strip empty too. A shell kept running from before the restart sits in a
// folder no worktree holds (`~/scratch`): it stays out of this worktree's strip and is reached
// from the strip's "elsewhere" menu instead.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const STRAY = 7

scenario('workbench-empty', {
  ipc: appIpc({
    workspace_read: { version: 2, activeWorktree: REPO, worktrees: [{ path: REPO, activeTab: '', tabs: [], panes: {} }] },
    pty_list: [{ id: STRAY, cwd: `${HOME}/scratch`, pid: 4242, alive: true }],
    pty_attach: () => [...Buffer.from(`${HOME}/scratch $ `)],
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    },
    worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc', isMain: true, dispatched: false, dirty: false, setupJob: null }],
  }),
})

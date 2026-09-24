// The commit composer (`commit.open`), opened over a worktree through the native menu's action
// event: six changes — one conflicted, so it cannot be picked — on a branch not pushed yet.
// `ai-commit-pr-failed` is the same with the steps failing: the notices each failure shows.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const TREE = `${REPO}-wt-ai-commit-pr`
const change = (path, index, worktree, extra = {}) => ({ path, origPath: null, index, worktree, conflicted: false, ...extra })

const ipc = (over = {}) =>
  appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 1758700000, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    workspace_read: {
      version: 2,
      activeWorktree: TREE,
      worktrees: [{ path: TREE, tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { 1: { view: 'terminal', cwd: TREE } }, activeTab: 'tab-1' }],
    },
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return 1
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_list: [],
    worktree_list: [],
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    commit_status: ({ worktree }) => {
      if (worktree !== TREE) throw new Error(`commit_status asked for ${worktree}`)
      return {
        root: TREE,
        branch: 'feat/orca-redesign-c/ai-commit-pr',
        remote: 'origin',
        published: false,
        ahead: 1,
        behind: 0,
        base: 'main',
        unborn: false,
        changes: [
          change('src-tauri/src/commit.rs', '?', '?'),
          change('src-tauri/src/lib.rs', '.', 'M'),
          change('src/commit/CommitDialog.tsx', 'A', '.'),
          change('src/commit/open.ts', 'R', '.', { origPath: 'src/commit/index.ts' }),
          change('docs/notes.md', 'U', 'U', { conflicted: true }),
          change('src/old-composer.tsx', '.', 'D'),
        ],
      }
    },
    commit_pr_find: null,
    ...over,
  })

const open = [{ event: 'app://action', payload: { id: 'commit.open' }, afterMs: 1500 }]

scenario('ai-commit-pr', { ipc: ipc(), events: open })

scenario('ai-commit-pr-failed', {
  ipc: ipc({
    commit_pr_find: () => {
      throw new Error('gh pr view: To get started with GitHub CLI, please run:  gh auth login')
    },
  }),
  events: open,
})

// The workbench of one worktree: one group, its row of four tabs the top band of the window
// between the sidebars' headers (no titlebar row above it), the second tab a split of three
// terminals (the middle one focused), with a Claude session working in the first tab, one waiting
// on you in the split, and one that finished in the last — each tab led by its agent's state,
// and the finished one, not on screen, washed as unread. The row ends with the titlebar's right
// cluster. A version 2 file, read as one group holding its tabs in order.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WORKING = 'a1b2c3d4-0000-4000-8000-000000000001'
const WAITING = 'a1b2c3d4-0000-4000-8000-000000000002'
const DONE = 'a1b2c3d4-0000-4000-8000-000000000003'

const term = (sessionId) => ({ view: 'terminal', cwd: REPO, ...(sessionId ? { sessionId } : {}) })
const leaf = (pane) => ({ kind: 'leaf', pane })

let next = 1

scenario('workbench-tabs', {
  ipc: appIpc({
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [
        {
          path: REPO,
          activeTab: 'tab-2',
          tabs: [
            { id: 'tab-1', root: leaf(1), focused: 1, name: 'fix the tailer' },
            {
              id: 'tab-2',
              root: { kind: 'split', dir: 'row', ratio: 0.55, children: [leaf(2), { kind: 'split', dir: 'col', ratio: 0.5, children: [leaf(3), leaf(4)] }] },
              focused: 3,
              name: 'orca redesign',
            },
            { id: 'tab-3', root: leaf(5), focused: 5 },
            { id: 'tab-4', root: leaf(6), focused: 6, name: 'release notes' },
          ],
          panes: { 1: term(WORKING), 2: term(), 3: term(WAITING), 4: term(), 5: term(), 6: term(DONE) },
        },
      ],
    },
    // Every session is live elsewhere, so the restore types no `claude --resume`.
    workspace_live_sessions: ({ ids }) => ids,
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return next++
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'feat/orca-redesign-b/workbench-tabs',
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc', isMain: true, dispatched: false, dirty: false, setupJob: null }],
  }),
  // The agents' hooks, as the app hears them: one starts a turn, one asks, one finishes.
  events: [
    { event: 'agent://event', payload: { sessionId: WORKING, cwd: REPO, kind: 'prompt', message: 'fix it', at: Date.now() + 60_000 }, afterMs: 900 },
    { event: 'agent://event', payload: { sessionId: WAITING, cwd: REPO, kind: 'notification', message: 'Claude needs your permission to use Bash', at: Date.now() + 60_000 }, afterMs: 900 },
    { event: 'agent://event', payload: { sessionId: DONE, cwd: REPO, kind: 'prompt', message: 'write it', at: Date.now() + 60_000 }, afterMs: 900 },
    { event: 'agent://event', payload: { sessionId: DONE, cwd: REPO, kind: 'stop', at: Date.now() + 60_001 }, afterMs: 1100 },
  ],
})

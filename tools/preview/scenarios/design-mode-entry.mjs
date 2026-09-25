// Finding Design Mode. A worktree whose only tab is a Claude session in a terminal, no browser
// pane anywhere:
//
// - `design-mode-entry`: ⌘K "Design Mode" opens a browser pane beside the terminal. Its blank page
//   says what the pane does, Design Mode first; the bar's labelled "Design" toggle is lit and the
//   strip says it turns on once a page loads.
// - `design-mode-entry-new-browser`: ⌘⇧B (the "+" menu's "New Browser Tab") opens a browser tab
//   on that blank page, Design Mode off.
//
// The "+" menu itself is opened by a click, which a scenario cannot send: shoot it by driving
// the page (memory `drive-the-preview-harness-interactively`).
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const SESSION = 'b7e1c2d4-0f3a-4c11-9e2d-5a6b7c8d9e0f'

const ipc = appIpc({
  home_snapshot: {
    repos: [{ root: REPO, name: 'mnemo-desktop', last_at: Date.now(), pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
    clone_base: '/Users/preview/code',
    errors: [],
    protected: 0,
  },
  mission_snapshot: {
    repos: [{ root: REPO, name: 'mnemo-desktop', parents: [{ session_id: SESSION, pid: 4242, name: 'settings page polish', status: 'idle', cwd: REPO }], missions: [], children: [] }],
    errors: [],
    at: '2026-09-25T12:00:00Z',
  },
  mission_looked: {},
  worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc123', isMain: true, dispatched: false, dirty: false, setupJob: null }],
  workspace_read: {
    version: 2,
    activeWorktree: REPO,
    worktrees: [
      {
        path: REPO,
        tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
        panes: { 1: { view: 'terminal', cwd: REPO, sessionId: SESSION } },
        activeTab: 'tab-1',
      },
    ],
  },
  workspace_live_sessions: [SESSION],
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
    return 1
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
  pty_list: [],
  chrome_repo: 'mnemo-desktop',
  chrome_branch: 'main',
  browser_create: null,
  browser_set_bounds: null,
  browser_destroy: null,
  browser_data_store: 'persistent',
})

scenario('design-mode-entry', { ipc, events: [{ event: 'app://action', payload: { id: 'browser.design-mode' }, afterMs: 1500 }] })
scenario('design-mode-entry-new-browser', { ipc, events: [{ event: 'app://action', payload: { id: 'tab.new-browser' }, afterMs: 1500 }] })

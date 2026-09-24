// The shell (wave B, `shell`): titlebar, workbench and status strip around a worktree. Two of
// them: a repo known and nothing saved, so its main checkout shows its empty state; and a saved
// workspace whose worktree shows one terminal.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WORKSPACE = `${REPO}-wt-login`

const repo = {
  root: REPO,
  name: 'mnemo-desktop',
  last_at: 1_790_000_000,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
}

const tree = (path, branch, isMain) => ({ path, branch, head: '0a7a6a982878681f399c03bd5c438cba5634d7cd', isMain, dispatched: false, dirty: false, setupJob: null })

const known = {
  home_snapshot: { repos: [repo], clone_base: `${HOME}/code`, errors: [], protected: 0 },
  worktree_list: [tree(REPO, 'main', true), tree(WORKSPACE, 'login', false)],
}

scenario('shell', { ipc: appIpc(known) })

scenario('shell-terminal', {
  ipc: appIpc({
    ...known,
    workspace_read: {
      version: 2,
      activeWorktree: WORKSPACE,
      worktrees: [
        {
          path: WORKSPACE,
          tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
          panes: { 1: { view: 'terminal', cwd: WORKSPACE } },
          activeTab: 'tab-1',
        },
      ],
    },
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return 1
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'login',
  }),
})

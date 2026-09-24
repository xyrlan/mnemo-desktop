// The quick-commands menu open at the titlebar's right end: the shown worktree's repo has three
// saved commands, and a terminal is focused to run them in. `quick-commands.open` opens the menu,
// as the palette would.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const now = Date.now()
const homeRepo = (root, name) => ({ root, name, last_at: now, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] })

scenario('quick-commands', {
  ipc: appIpc({
    settings_read: {
      quickCommands: {
        [REPO]: [
          { label: 'Dev server', command: 'pnpm tauri dev' },
          { label: 'Test', command: 'CARGO_TARGET_DIR=$HOME/.cache/mnemo pnpm test' },
          { label: 'Lint and typecheck', command: 'pnpm exec tsc --noEmit && pnpm lint' },
        ],
        [`${HOME}/code/vault-tools`]: [{ label: 'Sync', command: 'make sync' }],
      },
    },
    home_snapshot: { repos: [homeRepo(REPO, 'mnemo-desktop')], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    worktree_list: () => [
      { path: REPO, branch: 'refs/heads/main', head: '0a7a6a982878681f399c03bd5c438cba5634d7cd', isMain: true, dispatched: false, dirty: false, setupJob: null },
    ],
    mission_looked: {},
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [{ path: REPO, tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { 1: { view: 'terminal', cwd: REPO } }, activeTab: 'tab-1' }],
    },
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return 1
    },
    pty_list: [],
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
  }),
  events: [{ event: 'app://action', payload: { id: 'quick-commands.open' }, afterMs: 1500 }],
})

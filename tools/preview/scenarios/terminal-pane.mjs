// A workspace with one tab holding one terminal pane, showing a shell's output.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const PANE = 1

scenario('terminal-pane', {
  ipc: appIpc({
    // The saved workspace, as `workspace_read` returns `~/.mnemo-desktop/workspace.json`.
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'terminal', cwd: REPO } },
      activeTab: 'tab-1',
    },
    pty_spawn: ({ onOutput }) => {
      // After the reply, as a real pty's first bytes arrive after the spawn returns.
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return PANE
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
  }),
})

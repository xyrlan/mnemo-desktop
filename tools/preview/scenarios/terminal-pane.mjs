// A saved workspace with one tab holding one terminal pane, as the workbench saved it before the
// Nexus was the app (#459): the restore brings the shell back, and the drawer shows it in a tab
// of its own, with the shell's output.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const PANE = 1

// The core: what the shell printed is its screen, which an attach answers; from then on the shell
// prints to the channel that attached.
let channel = null
let printed = ''

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
      channel = onOutput
      // After the reply, as a real pty's first bytes arrive after the spawn returns.
      setTimeout(() => {
        printed = TERMINAL_OUTPUT
        void channel.sendBytes(TERMINAL_OUTPUT)
      }, 50)
      return PANE
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    // The restored pane is offscreen (#459): its drawer tab is drawn from the core's screen.
    pty_attach: ({ onOutput }) => {
      channel = onOutput
      return [...new TextEncoder().encode(printed)]
    },
    // The tab's changes chips: a clean tree.
    worktree_diff_files: ({ worktree }) => ({ root: worktree, files: [], truncated: false }),
  }),
})

// The floating terminal open over a workspace: a tab with one terminal pane, and the floating
// panel (`floating-terminal.toggle`, Mod+Alt+A) at its default place, bottom-right, holding the
// worktree's own shell.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const FLOATING_OUTPUT = [
  '\x1b[1;32m~/code/mnemo-desktop\x1b[0m \x1b[2m(main)\x1b[0m $ git status --short\r\n',
  ' M src/floating/view.tsx\r\n',
  '?? src/floating/store.ts\r\n',
  '\x1b[1;32m~/code/mnemo-desktop\x1b[0m \x1b[2m(main)\x1b[0m $ ',
].join('')

let spawned = 0

scenario('floating-terminal', {
  ipc: appIpc({
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'terminal', cwd: REPO } },
      activeTab: 'tab-1',
    },
    // The workbench's shell first, then the floating one.
    pty_spawn: ({ onOutput }) => {
      spawned += 1
      const id = spawned
      setTimeout(() => void onOutput.sendBytes(id === 1 ? TERMINAL_OUTPUT : FLOATING_OUTPUT), 50)
      return id
    },
    pty_list: [],
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
  }),
  events: [{ event: 'app://action', payload: { id: 'floating-terminal.toggle' }, afterMs: 900 }],
})

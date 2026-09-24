// The status bar under a running terminal pane: tokens, pulse count, agents by state, vault level.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

scenario('status-bar', {
  ipc: appIpc({
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'terminal', cwd: REPO } },
      activeTab: 'tab-1',
    },
    pty_spawn: 1,
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    vault_level: { root: '/vault', pages: 120, rules_fired: 40, fires: 300, fired_recent: 9, dormant: 20, label_only: 2, inbox: 3, error: null },
    vault_level_best: 640,
  }),
})

// Dictation (Mod+E) over a terminal pane, through the native menu's action event: Orca's
// indicator while listening, and after the second press the transcript it typed into the
// terminal, lingering under it.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const ipc = appIpc({
  workspace_read: {
    version: 1,
    tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
    panes: { 1: { view: 'terminal', cwd: REPO } },
    activeTab: 'tab-1',
  },
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => onOutput.sendBytes('~/code/mnemo-desktop $ '), 50)
    return 1
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
  pty_list: [],
  voice_start: null,
  voice_stop: 'run the voice tests and tell me what fails',
  // Outgoing text is rewritten in English by default; it already is.
  mission_translate: ({ text }) => text,
  voice_set_language: null,
})

const toggle = (afterMs) => ({ event: 'app://action', payload: { id: 'dictation.toggle' }, afterMs })

scenario('dictation', { ipc, events: [toggle(1500)] })
scenario('dictation-done', { ipc, events: [toggle(1200), toggle(1600)] })

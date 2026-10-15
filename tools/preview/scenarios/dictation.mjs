// Dictation (Mod+E) into the drawer's terminal (a saved shell the restore brings back in a tab of
// its own), through the native menu's action event: Orca's indicator while listening, and after
// the second press the transcript it typed into the terminal, lingering under it.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

// The core: what the shell printed is its screen, which an attach answers; from then on the shell
// prints to the channel that attached.
const PROMPT = '~/code/mnemo-desktop $ '
let channel = null
let printed = ''

const ipc = appIpc({
  workspace_read: {
    version: 1,
    tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
    panes: { 1: { view: 'terminal', cwd: REPO } },
    activeTab: 'tab-1',
  },
  pty_spawn: ({ onOutput }) => {
    channel = onOutput
    setTimeout(() => {
      printed = PROMPT
      void channel.sendBytes(PROMPT)
    }, 50)
    return 1
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
  pty_list: [],
  // The restored pane is offscreen (#459): its drawer tab is drawn from the core's screen.
  pty_attach: ({ onOutput }) => {
    channel = onOutput
    return [...new TextEncoder().encode(printed)]
  },
  // The drawer tab's changes chips: a clean tree.
  worktree_diff_files: ({ worktree }) => ({ root: worktree, files: [], truncated: false }),
  voice_start: 'MacBook Pro Microphone',
  voice_stop: 'run the voice tests and tell me what fails',
  // Outgoing text is rewritten in English by default; it already is.
  mission_translate: ({ text }) => text,
  voice_set_language: null,
})

const toggle = (afterMs) => ({ event: 'app://action', payload: { id: 'dictation.toggle' }, afterMs })

scenario('dictation', { ipc, events: [toggle(1500)] })
scenario('dictation-done', { ipc, events: [toggle(1200), toggle(1600)] })

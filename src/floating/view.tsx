/** The floating terminal. It has no pane view: it lives in `view.tsx` because App imports every
 *  `src/*\/view.tsx`, and that import is where it registers `floating-terminal.toggle` (the
 *  keymap binds Mod+Alt+A to it) and mounts itself in the shell's overlay and titlebar slots. */
import type React from 'react'
import { register } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { cwdForNewShell } from '../layout/cwd'
import { tauriPty } from '../pty/client'
import { mountInSlot } from '../shell/slots'
import { providedSessions, provideSessions } from '../terminal/sessions'
// Imported first: the terminal view offers the core's terminals as it loads, and the floating
// shells are then hidden from what it offers.
import TerminalPane from '../terminal/view'
import { FloatingTerminal, FloatingTerminalToggle, TOGGLE_SHORTCUT } from './FloatingTerminal'
import { createFloatingStore, hideFrom } from './store'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const sessions = providedSessions()

export const floating = createFloatingStore({
  pty: tauriPty,
  sessions,
  sinkOf: (id) => layout.getState().sinks[id],
  watchSinks: (cb) =>
    layout.subscribe((s, prev) => {
      if (s.sinks !== prev.sinks) cb()
    }),
  forgetSink: (id) =>
    layout.setState((s) => {
      if (!(id in s.sinks)) return {}
      const sinks = { ...s.sinks }
      delete sinks[id]
      return { sinks }
    }),
  storage: storage(),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
})

// The workspace restore adopts every running terminal no saved pane claims as a tab of its own:
// the floating shells, which outlive the page as the others do, are not its to adopt.
if (sessions) provideSessions(hideFrom(sessions, () => floating.getState().held()))
void floating.getState().prune()

/** The shell the panel shows is the active worktree's, started in its folder; with none open,
 *  where a new shell would start. */
function follow() {
  const { activeWorktree } = layout.getState()
  if (activeWorktree !== null) floating.getState().setWhere(activeWorktree, activeWorktree)
  else floating.getState().setWhere('', cwdForNewShell())
}
follow()
const unfollow = layout.subscribe((s, prev) => {
  if (s.activeWorktree !== prev.activeWorktree || (s.activeWorktree === null && s.activeTab !== prev.activeTab)) follow()
})

const reconcile = () => floating.getState().reconcile()
window.addEventListener('resize', reconcile)

register({ id: 'floating-terminal.toggle', title: 'Toggle floating terminal', shortcut: TOGGLE_SHORTCUT, run: () => floating.getState().toggle() })

function LiveFloatingTerminal(): React.JSX.Element {
  return <FloatingTerminal store={floating} terminal={TerminalPane} />
}
function LiveFloatingTerminalToggle(): React.JSX.Element {
  return <FloatingTerminalToggle store={floating} />
}

const unmount = [mountInSlot('overlay', LiveFloatingTerminal), mountInSlot('titlebar-right', LiveFloatingTerminalToggle)]
import.meta.hot?.dispose(() => {
  for (const u of unmount) u()
  unfollow()
  window.removeEventListener('resize', reconcile)
})

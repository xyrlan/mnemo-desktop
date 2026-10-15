/** The app's one session host (`./host`), for every presentation of a session: the drawer's tabs. */
import { store as layout } from '../layout/app-store'
import { tauriPty } from '../pty/client'
import { paneShell } from '../pty/typed'
import { hideFrom, providedSessions, provideSessions } from '../terminal/sessions'
// Imported first: the terminal view offers the core's terminals as it loads, and the attach PTYs
// are then hidden from what it offers.
import '../terminal/view'
import { createSessionHost, endLeftovers } from './host'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const deps = {
  pty: tauriPty,
  shell: () => paneShell(),
  feed: (id: number, b: Uint8Array) => layout.getState().feedTerminal(id, b),
  forget: (id: number) => layout.getState().forgetTerminal(id),
  storage: storage(),
}

export const sessionHost = createSessionHost(deps)

// The attaches a reloaded page left are ended; until then, and for the ones open now, the
// workspace restore must not adopt them as tabs.
const leftovers = endLeftovers(deps)
const sessions = providedSessions()
if (sessions) provideSessions(hideFrom(sessions, () => [...leftovers, ...sessionHost.getState().held()]))

// A pane closed takes its session with it, from every presentation.
const unwatch = layout.subscribe((s, prev) => {
  if (s.panes === prev.panes) return
  for (const h of Object.values(sessionHost.getState().sessions)) if (h.kind === 'pane' && h.pty !== null && !s.panes[h.pty]) sessionHost.getState().paneGone(h.pty)
})
import.meta.hot?.dispose(unwatch)

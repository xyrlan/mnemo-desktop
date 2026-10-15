/** The drawer as the app runs it: the app's session host, terminal view, conversation view (for a
 *  read-only tab) and diff, ⌘W claimed; the sessions the Nexus starts (`./start`), the Claude
 *  session each terminal runs, learnt here, and the tabs kept across a restart. Every terminal the
 *  app keeps is reachable: in a drawer tab, or through its live Claude's captain (`./persist`). A
 *  repo opens as a shell in a tab. */
import { toast } from '@/ui'
import { learnSession, SESSION_HIDDEN_MS, SESSION_POLL_MS, tauriSession } from '../../chrome/session'
import { paneRuns } from '../../chrome/running'
import { ConversationView } from '../../conversation/ConversationView'
import { tauriDiff } from '../../diff/client'
import { fleetStore } from '../../fleet/store'
import { store as layout } from '../../layout/app-store'
import { sessionHost } from '../../session/app-host'
import { settingsStore } from '../../settings/app-store'
import { pollWhileShown } from '../../shell/while-shown'
import TerminalPane from '../../terminal/view'
import { nexusStore } from '../store'
import type { DrawerDeps } from './Drawer'
import { claimClose } from './keys'
import { deepestWorktree } from './model'
import { launchDrawer, type Launch } from './launch'
import { createDrawer } from './sessions'
import { createSessions, type Sessions } from './start'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

let sessions: Sessions | null = null
const drawer = createDrawer(sessionHost, nexusStore, { letGo: (pane) => void sessions?.letGo(pane) })
const unclaim = claimClose(drawer, nexusStore)

/** A UUID for `claude --session-id`, also where the page is not a secure context. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const liveSessions: Sessions = (sessions = createSessions({
  layout,
  drawer,
  nexus: nexusStore,
  skipPermissions: () => (settingsStore.getState() as { skipPermissions?: boolean }).skipPermissions !== false,
  newId,
  runs: paneRuns,
  now: Date.now,
}))

// The drawer's part of the launch: the workbench's tabs pocketed, the tabs kept from the last run
// back, every terminal reachable; from then on tabs follow their pane's Claude session.
const launch: Launch = launchDrawer({ layout, drawer, nexus: nexusStore, sessions: liveSessions, runs: paneRuns, storage: storage() })

// Which Claude session each terminal runs, shown in a tab or not, then what runs in each
// (`Launch.check`): tabs follow it (`followPanes`), and the restore resumes it. A pane whose
// session could not be learnt keeps the one it had, and is still checked.
const stopLearning = pollWhileShown(
  async () => {
    await Promise.allSettled(Object.values(layout.getState().panes).flatMap((p) => (p.view === 'terminal' ? [learnSession(p.id, tauriSession, layout)] : [])))
    await launch.check()
  },
  SESSION_POLL_MS,
  { hiddenMs: SESSION_HIDDEN_MS, wait: true },
)

export const liveDrawer: DrawerDeps = {
  drawer,
  host: sessionHost,
  owners: layout,
  terminal: TerminalPane,
  conversation: ConversationView,
  diff: tauriDiff,
  worktreeOf: (cwd) => deepestWorktree(cwd, [...fleetStore.getState().repos.flatMap((r) => r.worktrees.map((w) => w.path)), ...layout.getState().worktrees]),
  paneOfSession: (sessionId) => liveSessions.paneOf(sessionId),
  goToRepo: (root) => void liveSessions.openSession({ kind: 'shell', root }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
}

import.meta.hot?.dispose(() => {
  launch.stop()
  unclaim()
  drawer.dispose()
  stopLearning()
})

/** The drawer as the app runs it: the app's session host, terminal view, conversation view (for a
 *  read-only tab) and diff, ⌘W claimed while the Nexus is open; the sessions the Nexus starts
 *  (`./start`), their Claude session learnt while no pane bar asks for it, and the tabs kept across
 *  a restart (`./persist`). */
import { learnSession, SESSION_HIDDEN_MS, SESSION_POLL_MS, tauriSession } from '../../chrome/session'
import { paneRunsClaude } from '../../chrome/running'
import { ConversationView } from '../../conversation/ConversationView'
import { tauriDiff } from '../../diff/client'
import { fleetStore } from '../../fleet/store'
import { store as layout } from '../../layout/app-store'
import { attachChild } from '../../mission/rows'
import { sessionHost } from '../../session/app-host'
import { settingsStore } from '../../settings/app-store'
import { pollWhileShown } from '../../shell/while-shown'
import TerminalPane from '../../terminal/view'
import { nexusStore } from '../store'
import type { DrawerDeps } from './Drawer'
import { claimClose } from './keys'
import { deepestWorktree } from './model'
import { readTabs, reopenTabs, tabsToSave, writeTabs } from './persist'
import { createDrawer } from './sessions'
import { createSessions, followPanes, type Sessions } from './start'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

let sessions: Sessions | null = null
const drawer = createDrawer(sessionHost, nexusStore, {
  goToPane: (id) => layout.getState().goToPane(id),
  attach: (child) => attachChild(child),
  closeNexus: () => nexusStore.getState().setOpen(false),
  letGo: (pane) => void sessions?.letGo(pane),
})
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
  runsClaude: paneRunsClaude,
}))

// The tabs kept from the last run come back once the layout store has its panes back; from then on
// what the drawer shows is kept. Tabs follow the Claude session their pane runs.
const kept = storage()
let restoring = true
const reopen = () => {
  if (!restoring || !layout.getState().restored) return
  restoring = false
  reopenTabs(readTabs(kept), layout.getState().panes, drawer, nexusStore)
}
const unwatchLayout = layout.subscribe((s, prev) => {
  reopen()
  if (s.panes !== prev.panes) followPanes(nexusStore, s.panes)
})
reopen()
const unwatchTabs = nexusStore.subscribe((s, prev) => {
  if (restoring || (s.tabs === prev.tabs && s.activeTab === prev.activeTab)) return
  writeTabs(kept, tabsToSave(s))
})

// An offscreen pane has no pane bar to learn which Claude session it runs: asked here, as often.
const stopLearning = pollWhileShown(
  () => Promise.all(Object.values(layout.getState().panes).flatMap((p) => (p.offscreen ? [learnSession(p.id, tauriSession, layout)] : []))),
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
  goToRepo: (root) => {
    nexusStore.getState().setOpen(false)
    void layout.getState().switchWorktree(root)
  },
}

import.meta.hot?.dispose(() => {
  unclaim()
  drawer.dispose()
  unwatchLayout()
  unwatchTabs()
  stopLearning()
})

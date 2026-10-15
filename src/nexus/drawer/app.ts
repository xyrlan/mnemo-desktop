/** The drawer as the app runs it: the app's session host, terminal view, conversation view and
 *  diff, its conversations typing into the app's terminals, ⌘W claimed while the Nexus is open and
 *  ⌘⇧C while the drawer has the keyboard. */
import { paneRunsClaude } from '../../chrome/running'
import { ConversationView } from '../../conversation/ConversationView'
import { tauriDiff } from '../../diff/client'
import { fleetStore } from '../../fleet/store'
import { store as layout } from '../../layout/app-store'
import { attachChild } from '../../mission/rows'
import { tauriPty } from '../../pty/client'
import { sessionHost } from '../../session/app-host'
import { readBuffer } from '../../terminal/buffer'
import TerminalPane from '../../terminal/view'
import { nexusStore } from '../store'
import { sessionAgent, type AgentSinks } from './agent'
import type { DrawerDeps } from './Drawer'
import { claimClose, claimFace } from './keys'
import { deepestWorktree } from './model'
import { createDrawer } from './sessions'

const drawer = createDrawer(sessionHost, nexusStore, {
  goToPane: (id) => layout.getState().goToPane(id),
  attach: (child) => attachChild(child),
  closeNexus: () => nexusStore.getState().setOpen(false),
})
const unclaim = claimClose(drawer, nexusStore)
const unclaimFace = claimFace(nexusStore)

const keys = { writePty: (pty: number, data: string) => tauriPty.write(pty, data), screen: readBuffer, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }
const sinks: AgentSinks = { pane: { ...keys, runsClaude: paneRunsClaude }, attach: keys }

export const liveDrawer: DrawerDeps = {
  drawer,
  host: sessionHost,
  owners: layout,
  terminal: TerminalPane,
  conversation: ConversationView,
  agent: (session) => sessionAgent(session, sinks),
  diff: tauriDiff,
  worktreeOf: (cwd) => deepestWorktree(cwd, [...fleetStore.getState().repos.flatMap((r) => r.worktrees.map((w) => w.path)), ...layout.getState().worktrees]),
  paneOfSession: (sessionId) =>
    Object.values(layout.getState().panes).find((p) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && p.sessionId === sessionId)?.id ?? null,
  goToRepo: (root) => {
    nexusStore.getState().setOpen(false)
    void layout.getState().switchWorktree(root)
  },
}

import.meta.hot?.dispose(() => {
  unclaim()
  unclaimFace()
  drawer.dispose()
})

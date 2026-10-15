/** The drawer as the app runs it: the app's session host, terminal view, conversation view and
 *  diff, and ⌘W claimed while the drawer has the keyboard. */
import { ConversationView } from '../../conversation/ConversationView'
import { tauriDiff } from '../../diff/client'
import { fleetStore } from '../../fleet/store'
import { store as layout } from '../../layout/app-store'
import { attachChild } from '../../mission/rows'
import { sessionHost } from '../../session/app-host'
import TerminalPane from '../../terminal/view'
import { nexusStore } from '../store'
import type { DrawerDeps } from './Drawer'
import { claimClose } from './keys'
import { deepestWorktree } from './model'
import { createDrawer } from './sessions'

const drawer = createDrawer(sessionHost, nexusStore, {
  goToPane: (id) => layout.getState().goToPane(id),
  attach: (child) => attachChild(child),
  closeNexus: () => nexusStore.getState().setOpen(false),
})
const unclaim = claimClose(drawer, nexusStore)

export const liveDrawer: DrawerDeps = {
  drawer,
  host: sessionHost,
  owners: layout,
  terminal: TerminalPane,
  conversation: ConversationView,
  diff: tauriDiff,
  worktreeOf: (cwd) => deepestWorktree(cwd, [...fleetStore.getState().repos.flatMap((r) => r.worktrees.map((w) => w.path)), ...layout.getState().worktrees]),
  goToRepo: (root) => {
    nexusStore.getState().setOpen(false)
    void layout.getState().switchWorktree(root)
  },
}

import.meta.hot?.dispose(() => {
  unclaim()
  drawer.dispose()
})

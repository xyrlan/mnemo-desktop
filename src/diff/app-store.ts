import { store as layout } from '../layout/app-store'
import { fleetStore } from '../fleet/store'
import { missionStore } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { allChildren } from '../mission/types'
import { tauriPty } from '../pty/client'
import { tauriDiff } from './client'
import { findTarget } from './deliver'
import { createDiffStore } from './store'

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The app's one diff store: every worktree's changes as last read, and the notes not sent yet.
 *  The workbench's diff pane and the Nexus's Changes window share it, so a note written in one
 *  shows in the other. */
export const diffStore = createDiffStore({
  client: tauriDiff,
  target: (worktree) => {
    const st = layout.getState()
    const snap = missionStore.getState().snapshot
    return findTarget(worktree, {
      repos: fleetStore.getState().repos,
      children: snap ? allChildren(snap) : [],
      panes: st.panes,
      focused: st.tabs.find((t) => t.id === st.activeTab)?.focused ?? null,
    })
  },
  deliver: { reply: (id, text) => tauriMission.reply(id, text), write: (pane, data) => tauriPty.write(pane, data) },
  storage: localStorageOrNull(),
})

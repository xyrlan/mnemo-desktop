import type { StoreApi } from 'zustand/vanilla'
import type { Store } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import type { NexusState } from '../store'
import { adoptIdle, adoptShells, lostPanes, readTabs, reopenTabs, tabsToSave, writeTabs } from './persist'
import type { Drawer } from './sessions'
import { followPanes, RESUME_WINDOW_MS, type Sessions } from './start'

export type LaunchDeps = {
  layout: Store
  drawer: Drawer
  nexus: StoreApi<NexusState>
  sessions: Sessions
  /** Whether a Claude runs under pane `pane`'s shell now; rejects when that cannot be told. */
  runsClaude(pane: PaneId): Promise<boolean>
  storage: (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null
  now(): number
}

export type Launch = {
  /** When the restore brought the saved panes back; null before it has. */
  restoredAt(): number | null
  stop(): void
}

/** The drawer's part of the app's launch, in its order (`drawer/app.ts` runs it):
 *  1. once the layout store has restored the saved panes, a workspace the workbench saved has its
 *     tabs' terminals made offscreen panes (`pocketTabs`, #459);
 *  2. the drawer's tabs kept from the last run come back (`reopenTabs`), and every shell no tab
 *     shows gets one (`adoptShells`);
 *  3. `RESUME_WINDOW_MS` later, the panes no tab shows that hold a Claude session id are asked
 *     whether a Claude runs there (`adoptIdle`).
 *  From then on, tabs follow the Claude session their pane runs (`followPanes`), and a pane no tab
 *  shows whose session went ends when a tab had let it go, else gets a tab of its own, quietly.
 *  What the drawer shows is kept. */
export function launchDrawer(d: LaunchDeps): Launch {
  let restoring = true
  let restoredAt: number | null = null
  let idleCheck: ReturnType<typeof setTimeout> | undefined
  const panes = () => d.layout.getState().panes

  const reopen = () => {
    if (!restoring || !d.layout.getState().restored) return
    restoring = false
    restoredAt = d.now()
    d.layout.getState().pocketTabs()
    reopenTabs(readTabs(d.storage), panes(), d.drawer, d.nexus)
    adoptShells(panes(), d.drawer, d.nexus)
    idleCheck = setTimeout(() => void adoptIdle(panes, d.drawer, d.nexus, d.runsClaude, d.sessions.markIdle), RESUME_WINDOW_MS)
  }
  const unwatchLayout = d.layout.subscribe((s, prev) => {
    reopen()
    if (s.panes === prev.panes) return
    followPanes(d.nexus, s.panes, d.sessions.isIdle)
    if (restoring) return
    for (const pane of lostPanes(prev.panes, s.panes)) {
      void d.sessions.lost(pane).then((ended) => {
        if (!ended) adoptShells(panes(), d.drawer, d.nexus, new Set([pane]))
      })
    }
  })
  reopen()
  const unwatchTabs = d.nexus.subscribe((s, prev) => {
    if (restoring || (s.tabs === prev.tabs && s.activeTab === prev.activeTab)) return
    writeTabs(d.storage, tabsToSave(s))
  })

  return {
    restoredAt: () => restoredAt,
    stop() {
      clearTimeout(idleCheck)
      unwatchLayout()
      unwatchTabs()
    },
  }
}

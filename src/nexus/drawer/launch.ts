import type { StoreApi } from 'zustand/vanilla'
import type { PaneRuns } from '../../chrome/running'
import type { Pane, Store } from '../../layout/store'
import type { PaneId } from '../../layout/tree'
import type { NexusState } from '../store'
import { adoptPanes, adoptShells, lostPanes, readTabs, reopenTabs, tabsToSave, writeTabs } from './persist'
import type { Drawer } from './sessions'
import { followPanes, type Sessions } from './start'

export type LaunchDeps = {
  layout: Store
  drawer: Drawer
  nexus: StoreApi<NexusState>
  sessions: Sessions
  /** What runs in pane `pane` now (`paneRuns`); never rejects. */
  runs(pane: PaneId): Promise<PaneRuns>
  storage: (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null
}

export type Launch = {
  /** Asks what runs in every terminal that holds a Claude session id or that no tab shows
   *  (`Sessions.observe`), then has the tabs follow what was found, and opens a tab on each such
   *  terminal nothing leads to. Run once the drawer's tabs are back, and at each session poll
   *  (`drawer/app.ts`); a check asked while one runs is that one. */
  check(): Promise<void>
  stop(): void
}

/** The drawer's part of the app's launch, in its order (`drawer/app.ts` runs it):
 *  1. once the layout store has restored the saved panes, a workspace the workbench saved has its
 *     tabs' terminals made offscreen panes (`pocketTabs`, #459);
 *  2. the drawer's tabs kept from the last run come back (`reopenTabs`), and every shell no tab
 *     shows gets one (`adoptShells`);
 *  3. every terminal that holds a Claude session id is asked what runs there (`check`), and again
 *     at every session poll: on each launch alike, since what was found is not kept (#460).
 *  From then on, tabs follow the Claude session their pane was found running (`followPanes`); a
 *  pane no tab shows that holds a session id gets a tab of its own, quietly, once no Claude runs
 *  or may be coming up there; one whose session went ends when a tab had let it go, else gets a
 *  tab too. What the drawer shows is kept. */
export function launchDrawer(d: LaunchDeps): Launch {
  let restoring = true
  let checking: Promise<void> | null = null
  const panes = () => d.layout.getState().panes
  const live = (p: Pane) => p.view === 'terminal' && p.id > 0 && p.exitCode === undefined && !p.error
  const shown = (pane: PaneId) => d.nexus.getState().tabs.some((t) => t.key === `pane:${pane}`)

  async function ask(): Promise<void> {
    const asked = Object.values(panes()).filter((p) => live(p) && (p.sessionId || !shown(p.id)))
    const runs = await Promise.all(asked.map((p) => d.runs(p.id)))
    const adopt: Pane[] = []
    for (const [i, p] of asked.entries()) {
      const now = panes()[p.id]
      // Its session changed meanwhile, or it went: the next check asks again.
      if (!now || !live(now) || now.sessionId !== p.sessionId) continue
      if (await d.sessions.observe(p.id, runs[i])) continue
      // A Claude runs there (its captain leads to it), may be coming up, or a tab let it go.
      if (runs[i] === 'claude' || d.sessions.mayBeStarting(p.id) || d.sessions.isReleased(p.id)) continue
      adopt.push(now)
    }
    followPanes(d.nexus, panes(), d.sessions)
    adoptPanes(adopt, d.drawer, d.nexus)
  }
  const check = () => {
    if (restoring) return Promise.resolve()
    // A pane that could not be closed stays released: the next check tries again.
    return (checking ??= ask()
      .catch(() => undefined)
      .finally(() => (checking = null)))
  }

  const reopen = () => {
    if (!restoring || !d.layout.getState().restored) return
    restoring = false
    d.layout.getState().pocketTabs()
    reopenTabs(readTabs(d.storage), panes(), d.drawer, d.nexus)
    adoptShells(panes(), d.drawer, d.nexus)
    void check()
  }
  const unwatchLayout = d.layout.subscribe((s, prev) => {
    reopen()
    if (s.panes === prev.panes) return
    followPanes(d.nexus, s.panes, d.sessions)
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
    check,
    stop() {
      unwatchLayout()
      unwatchTabs()
    },
  }
}

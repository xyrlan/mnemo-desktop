import { useStore } from 'zustand'
import { homeStore } from '../home/app-store'
import { missionStore } from '../mission/app-store'
import { store as layout } from '../layout/app-store'
import { createFleet } from './create'
import { listWorktrees, subscribeAgentEvents } from './upstream'
import type { Fleet } from './types'

export type { AgentNode, Fleet, RepoNode, WorktreeNode } from './types'
export type { PolledMove } from './create'

/** The single live fleet, wired to the app's stores. The logic is `createFleet` (`create.ts`),
 *  which tests drive without Tauri. */
const fleet = createFleet({
  home: () => homeStore.getState().snapshot,
  mission: () => missionStore.getState().snapshot,
  panes: () => layout.getState().panes,
  // No worktree is shown as a whole in the Nexus: a worktree is read through `markRead`, as a
  // notification's figure opens (#459).
  shown: () => null,
  listWorktrees,
  subscribeAgentEvents,
  onChange(cb) {
    const offs = [
      homeStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
      missionStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
      layout.subscribe((s, p) => void (s.panes !== p.panes && cb())),
    ]
    return () => offs.forEach((off) => off())
  },
  async reload({ withPrs, home }) {
    // Every repo: the Nexus shows the whole fleet, with no folder in focus.
    await Promise.all([missionStore.getState().refresh(undefined, withPrs), home ? homeStore.getState().load() : undefined])
  },
})
fleet.connect()

export const fleetStore = fleet.store
/** What polling saw move that no hook told of (`PolledMove`), for the notifier. */
export const subscribePolledMoves = fleet.onPolledMove
export const useFleet = <T,>(sel: (f: Fleet) => T): T => useStore(fleetStore, sel)

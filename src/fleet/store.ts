import { useStore } from 'zustand'
import { homeStore } from '../home/app-store'
import { missionStore } from '../mission/app-store'
import { focusedCwd } from '../mission/scope'
import { store as layout } from '../layout/app-store'
import { createFleet } from './create'
import { listWorktrees, subscribeAgentEvents } from './upstream'
import type { Fleet } from './types'

export type { AgentNode, Fleet, RepoNode, WorktreeNode } from './types'

/** The single live fleet, wired to the app's stores. The logic is `createFleet` (`create.ts`),
 *  which tests drive without Tauri. */
const fleet = createFleet({
  home: () => homeStore.getState().snapshot,
  mission: () => missionStore.getState().snapshot,
  panes: () => layout.getState().panes,
  // `activeWorktree` is the workspace-model piece's; until it lands nothing is shown as a
  // worktree, and cards are read only through `markRead`.
  shown: () => (layout.getState() as { activeWorktree?: string | null }).activeWorktree ?? null,
  listWorktrees,
  subscribeAgentEvents,
  onChange(cb) {
    const offs = [
      homeStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
      missionStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && cb())),
      layout.subscribe((s, p) => void ((s.panes !== p.panes || (s as { activeWorktree?: unknown }).activeWorktree !== (p as { activeWorktree?: unknown }).activeWorktree) && cb())),
    ]
    return () => offs.forEach((off) => off())
  },
  async reload({ withPrs, home }) {
    const cwd = focusedCwd(layout.getState(), missionStore.getState().snapshot)
    await Promise.all([missionStore.getState().refresh(cwd, withPrs), home ? homeStore.getState().load() : undefined])
  },
})
fleet.connect()

export const fleetStore = fleet.store
export const useFleet = <T,>(sel: (f: Fleet) => T): T => useStore(fleetStore, sel)

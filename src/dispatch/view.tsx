import { registerPaneView } from '../panes/registry'
import { register, registerProvider } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { missionStore } from '../mission/app-store'
import { allChildren } from '../mission/types'
import { fleetStore } from '../fleet/store'
import { parentOf, wavesOf } from './model'
import { rowLook } from './list'
import { knownWorktrees, openDispatch, parentPaneOf, parentWorktree } from './live'
import { VIEW } from './open'
import { bornOf } from './seen'
import { watchDispatches } from './watch'
import { DispatchPane } from './pane'

/** The Dispatch tab: a pane view (App imports every `src/*\/view.tsx`), the watch that opens it
 *  when a wave is dispatched, and ⌘K's ways back to it once closed (spec decision 4). */

registerPaneView(VIEW, DispatchPane)

const stop = watchDispatches({
  layout,
  mission: missionStore,
  parentOf: (c) => parentWorktree(c.id),
  paneOf: parentPaneOf,
  now: () => Date.now(),
})
import.meta.hot?.dispose(stop)

register({
  id: 'dispatch.open',
  title: "Open this workspace's Dispatch tab",
  run: () => {
    const at = layout.getState().activeWorktree
    if (at) openDispatch(at)
  },
})

/** One entry per wave of every parent workspace, and one per child still running: ⌘K reaches
 *  any of them once the tab is closed. */
registerProvider(() => {
  const snap = missionStore.getState().snapshot
  const known = knownWorktrees(fleetStore.getState().repos, layout.getState().worktrees)
  const parents = [...new Set(allChildren(snap).flatMap((c) => parentOf(snap, c.id, known) ?? []))]
  return parents.flatMap((parent) => {
    const name = parent.split('/').pop() || parent
    return wavesOf(snap, parent, known, bornOf).flatMap((w) => {
      const label = w.issues ? `issues of ${name}` : w.feature
      const asks = w.needsYou ? ` (${w.needsYou} need${w.needsYou === 1 ? 's' : ''} you)` : ''
      return [
        { id: `dispatch.open.${parent}.${w.feature}`, title: `Dispatch: ${label}${asks}`, run: () => openDispatch(parent, w.feature) },
        ...w.rows.flatMap((r) =>
          r.child?.live ? [{ id: `dispatch.child.${r.child.id}`, title: `Dispatch: ${label} · ${r.piece} (${rowLook(r).word})`, run: () => openDispatch(parent, r.child!.id) }] : [],
        ),
      ]
    })
  })
})

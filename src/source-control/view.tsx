/** The right sidebar's Source Control tab. It has no pane view: it lives in `view.tsx` because
 *  App imports every `src/*\/view.tsx`, and that import is where it registers its tab. */
import type React from 'react'
import { GitBranch } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { register } from '../actions/registry'
import { store as layout, useApp } from '../layout/app-store'
import { shellStore } from '../shell/store'
import { useFleet } from '../fleet/store'
import { commitOpenStore, openCommit } from '../commit/open'
import { openDiff } from '../diff/view'
import { tauriScm, type ScmEntry } from './client'
import { createScmStore } from './store'
import { currentWorktree, pickInDiff, pickRightbarTab, serialWatch, useLiveChanges, type LiveDeps } from './live'
import { SourceControlPanel } from './SourceControlPanel'

type RightbarPanels = {
  registerRightbarPanel?(item: { id: string; title: string; icon: React.ComponentType<{ className?: string }>; order: number; panel: React.ComponentType }): () => void
}

/** The single live store: what it read survives the tab being switched away and back. */
const scm = createScmStore(tauriScm)

const live: LiveDeps = {
  client: tauriScm,
  watch: serialWatch(tauriScm),
  onCommitClosed: (on) =>
    commitOpenStore.subscribe((s, prev) => {
      if (prev.worktree !== null && s.worktree === null) on()
    }),
}

/** The diff tab on `worktree`'s changes, showing `entry`'s file. */
function openEntry(worktree: string, entry: ScmEntry) {
  openDiff(worktree)
  const st = layout.getState()
  const pane = st.tabs.find((t) => t.id === st.activeTab)?.focused
  if (pane != null && st.panes[pane]?.view === 'diff') pickInDiff(pane, entry.path)
}

function LiveSourceControl(): React.JSX.Element {
  const view = useApp(useShallow((s) => ({ activeWorktree: s.activeWorktree, activeTab: s.activeTab, tabs: s.tabs, panes: s.panes })))
  const repos = useFleet((f) => f.repos)
  const worktree = currentWorktree(view, repos)
  useLiveChanges(worktree, scm, live)
  return <SourceControlPanel worktree={worktree} store={scm} onOpen={openEntry} onCommit={openCommit} />
}

// The registry is `rightbar-panels`' (wave D); found by glob, this tab joins the sidebar
// whichever of the two lands first.
const TITLE = 'Source Control'
const panels = Object.values(import.meta.glob<RightbarPanels>('../rightbar/panels.ts', { eager: true }))[0]
const unregister = panels?.registerRightbarPanel?.({ id: 'source-control', title: TITLE, icon: GitBranch, order: 400, panel: LiveSourceControl })

register({
  id: 'source-control.show',
  title: 'Source Control (stage, discard, commit)',
  run: () => {
    if (!shellStore.getState().rightOpen) shellStore.getState().toggleRight()
    pickRightbarTab(TITLE)
  },
})
import.meta.hot?.dispose(() => unregister?.())

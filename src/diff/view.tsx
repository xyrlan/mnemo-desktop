import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { all, register, run } from '../actions/registry'
import { store as layout } from '../layout/app-store'
import { leaves } from '../layout/tree'
import { fleetStore } from '../fleet/store'
import { norm, within } from '../fleet/model'
import { missionStore } from '../mission/app-store'
import { tauriMission } from '../mission/client'
import { allChildren } from '../mission/types'
import { tauriPty } from '../pty/client'
import { tauriDiff } from './client'
import { findTarget } from './deliver'
import { createDiffStore } from './store'
import { DiffPane } from './DiffPane'

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The app's one diff store: every worktree's changes as last read, and the notes not sent yet. */
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

const COMMIT = 'commit.open'

function commit(worktree: string) {
  if (all().some((a) => a.id === COMMIT)) return run(COMMIT)
  diffStore.setState((s) => ({ sent: { ...s.sent, [worktree]: { sending: false, ok: null, error: 'The commit composer is not available in this build.' } } }))
}

function Diff(p: PaneViewProps) {
  const worktree = typeof p.props.worktree === 'string' ? p.props.worktree : ''
  return <DiffPane {...p} store={diffStore} onCommit={() => commit(worktree)} />
}

registerPaneView('diff', Diff)

/** The worktree shown; before one is chosen, the one the focused pane's folder is in. */
function currentWorktree(): string | null {
  const st = layout.getState()
  if (st.activeWorktree) return st.activeWorktree
  const cwd = st.panes[st.tabs.find((t) => t.id === st.activeTab)?.focused ?? NaN]?.cwd
  if (!cwd) return null
  const trees = fleetStore.getState().repos.flatMap((r) => r.worktrees.map((w) => norm(w.path)))
  return trees.filter((t) => within(cwd, t)).sort((a, b) => b.length - a.length)[0] ?? cwd
}

/** The shown worktree's changes: the diff tab already open for it, else a new one. */
export function openDiff(worktree: string | null = currentWorktree()) {
  const st = layout.getState()
  const shown = new Set(st.tabs.flatMap((t) => leaves(t.root)))
  const open = Object.values(st.panes).find((p) => p.view === 'diff' && shown.has(p.id) && p.props?.worktree === (worktree ?? ''))
  if (open) st.goToPane(open.id)
  else st.openView('diff', { worktree: worktree ?? '' }, 'tab', 'Changes')
}

register({ id: 'diff.open', title: 'Changes (diff with notes for the agent)', shortcut: '⌘⇧G', run: () => openDiff() })

import React from 'react'
import { Files } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { store as layout, useApp } from '../layout/app-store'
import { useFleet } from '../fleet/store'
import { toast } from '@/ui'
import { tauriExplorer } from './client'
import { FileExplorer } from './FileExplorer'
import { basename } from './paths'
import { repoNameOf, rootOf } from './target'
import { createExplorerStore } from './store'

/** One store for the app: what was read and opened survives the tab closing and coming back. */
const explorer = createExplorerStore(tauriExplorer)

type LayoutView = { activeWorktree: string | null; activeFile: string | null }

function LiveExplorer(): React.JSX.Element {
  const view = useApp(
    useShallow((s): LayoutView => {
      const tab = s.tabs.find((t) => t.id === s.activeTab)
      const pane = tab ? s.panes[tab.focused] : undefined
      const path = pane?.view === 'editor' ? pane.props?.path : undefined
      return { activeWorktree: s.activeWorktree, activeFile: typeof path === 'string' && path ? path : null }
    }),
  )
  const repos = useFleet((f) => f.repos)
  const root = rootOf(view.activeWorktree, repos)
  // An agent finishing a turn in this worktree has likely written files.
  let stamp = ''
  for (const r of repos) for (const w of r.worktrees) if (w.path === root) for (const a of w.agents) stamp += `${a.sessionId}:${a.state}:${a.since};`

  return (
    <FileExplorer
      store={explorer}
      root={root}
      repoName={root ? repoNameOf(root, repos) : ''}
      activeFile={view.activeFile}
      stamp={stamp}
      onOpenFile={(path, place) => layout.getState().openView('editor', root ? { path, root } : { path }, place, basename(path))}
      onOpenInTerminal={(dir) => void layout.getState().newTab(dir)}
      onCopy={(text) =>
        void navigator.clipboard.writeText(text).then(
          () => toast.success('Copied'),
          (e) => toast.error(`Could not copy: ${e}`),
        )
      }
    />
  )
}

type RegisterRightbarPanel = (item: {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  order: number
  panel: React.ComponentType
}) => () => void

// The right sidebar's panel registry lands beside this piece (wave D, `rightbar-panels`): until it
// is on this branch the glob finds nothing and the tab waits; after the merge it wires itself.
const panels = Object.values(import.meta.glob<{ registerRightbarPanel?: RegisterRightbarPanel }>('../rightbar/panels.ts', { eager: true }))[0]

/** After Memory (Orca's order: Explorer, then Search and Source Control). */
export const EXPLORER_ORDER = 10

const unregister = panels?.registerRightbarPanel?.({ id: 'explorer', title: 'Explorer', icon: Files, order: EXPLORER_ORDER, panel: LiveExplorer })
import.meta.hot?.dispose(() => unregister?.())

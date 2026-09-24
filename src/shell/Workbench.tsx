import { memo, useMemo } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { store as appLayout } from '../layout/app-store'
import type { Store, Tab } from '../layout/store'
import SplitView from '../layout/SplitView'
import ErrorBoundary from '../panes/ErrorBoundary'
import { useFleet } from '../fleet/store'
import type { RepoNode } from '../fleet/types'
import { homeStore } from '../home/app-store'
import { settingsStore } from '../settings/app-store'
import { EmptyWorktree, NoProjects } from './EmptyWorkbench'

const NONE: readonly Tab[] = []

/** One tab the workbench keeps mounted, and the worktree it belongs to (null: a tab opened
 *  before any worktree was chosen). */
export type Layer = { tab: Tab; worktree: string | null }

/** Every open worktree's tabs, in the order the worktrees were opened, after the tabs of no
 *  worktree. A worktree switch changes nothing here — only which layer shows — so no pane view
 *  is remounted by one: a terminal keeps its screen. */
export function workbenchLayers(loose: readonly Tab[], worktrees: readonly string[], tabsOf: readonly (readonly Tab[])[]): Layer[] {
  return [...loose.map((tab) => ({ tab, worktree: null })), ...worktrees.flatMap((worktree, i) => (tabsOf[i] ?? NONE).map((tab) => ({ tab, worktree })))]
}

/** What "Launch agent" types: `claude`, skipping its permission prompts unless Settings say
 *  not to (spec, *How a parallel agent is born*; the toggle is `skipPermissions`). */
export function agentCommand(skipPermissions: boolean | undefined): string {
  return skipPermissions === false ? 'claude' : 'claude --dangerously-skip-permissions'
}

/** The worktree at `path` as the fleet knows it: its name, branch and repo. */
export function describeWorktree(repos: readonly RepoNode[], path: string): { name: string; branch: string | null; repo: string | null } {
  for (const r of repos) {
    const w = r.worktrees.find((w) => w.path === path)
    if (w) return { name: w.name, branch: w.branch, repo: r.name }
  }
  const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return { name: base || path, branch: null, repo: null }
}

const TabLayer = memo(function TabLayer({ tab, visible, layout }: { tab: Tab; visible: boolean; layout: Store }) {
  const title = useStore(layout, (s) => s.panes[tab.focused]?.title)
  return (
    <div data-tab={tab.id} style={{ position: 'absolute', inset: 0, display: visible ? 'block' : 'none' }}>
      <ErrorBoundary label={`tab ${title || 'shell'}`}>
        <SplitView node={tab.root} />
      </ErrorBoundary>
    </div>
  )
})

function Empty({ path, layout }: { path: string; layout: Store }) {
  const repos = useFleet((f) => f.repos)
  const about = describeWorktree(repos, path)
  const command = () => agentCommand((settingsStore.getState() as { skipPermissions?: boolean }).skipPermissions)
  return (
    <EmptyWorktree
      {...about}
      agentCommand={command()}
      onNewTerminal={() => void layout.getState().newTab(path)}
      onLaunchAgent={() => void layout.getState().openCommandTab(path, command())}
    />
  )
}

function Unchosen() {
  const known = useFleet((f) => f.repos.length > 0)
  // With a repo known, the first one's main checkout is about to show (`keepAWorktreeShown`).
  return known ? null : <NoProjects onOpenFolder={() => void homeStore.getState().openFolder()} />
}

type Props = {
  /** The saved workspace is restored: until then an empty worktree may only be one whose tabs
   *  have not come back yet, and nothing is said about it. */
  ready: boolean
  /** Why the saved workspace could not be restored, until dismissed. */
  notice: string | null
  onDismissNotice(): void
  layout?: Store
}

/** The panes of every open worktree, only the shown worktree's shown tab visible; its empty
 *  state when that worktree has no tab. The pane views keep today's look inside the `.app`
 *  scope `src/theme.css` keeps for them. */
export default function Workbench({ ready, notice, onDismissNotice, layout = appLayout }: Props) {
  const worktrees = useStore(layout, (s) => s.openWorktrees())
  const loose = useStore(layout, (s) => (s.activeWorktree === null ? s.tabs : NONE))
  const tabsOf = useStore(layout, useShallow((s) => s.openWorktrees().map((w) => s.worktreeTabs(w))))
  const active = useStore(layout, (s) => s.activeWorktree)
  const activeTab = useStore(layout, (s) => s.activeTab)
  const layers = useMemo(() => workbenchLayers(loose, worktrees, tabsOf), [loose, worktrees, tabsOf])
  const showing = layers.some((l) => l.worktree === active && l.tab.id === activeTab)

  return (
    <div data-shell-workbench className="relative flex min-h-0 min-w-0 flex-1">
      <div className="app" style={{ position: 'absolute', inset: 0 }}>
        {layers.map(({ tab, worktree }) => (
          <TabLayer key={tab.id} tab={tab} visible={worktree === active && tab.id === activeTab} layout={layout} />
        ))}
      </div>
      {ready && !showing && (active === null ? <Unchosen /> : <Empty path={active} layout={layout} />)}
      {notice && (
        <button
          type="button"
          title="Dismiss"
          onClick={onDismissNotice}
          className="absolute top-3 left-1/2 z-10 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-md border border-status-warning-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-floating animate-in fade-in-0 slide-in-from-top-1"
        >
          <span className="truncate">{notice}</span>
          <X className="size-3 shrink-0 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

import { useMemo, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { store as appLayout } from '../layout/app-store'
import { ELSEWHERE, type Store, type Tab } from '../layout/store'
import { PaneLayer, type PlacedTab } from '../layout/SplitView'
import { below, boxStyle, FULL } from '../chrome/geometry'
import TabGroups from '../tab-group/TabGroups'
import { groupLayout, ROW_H } from '../tab-group/layout'
import { useFleet } from '../fleet/store'
import type { RepoNode } from '../fleet/types'
import { homeStore } from '../home/app-store'
import { settingsStore } from '../settings/app-store'
import { EmptyWorktree, NoProjects } from './EmptyWorkbench'
import { firstWorktree } from './first-worktree'

const NONE: readonly Tab[] = []

/** One tab the workbench keeps mounted, and the worktree it belongs to (null: a tab opened
 *  before any worktree was chosen; `ELSEWHERE`: a tab of no open worktree, never shown here). */
export type Layer = { tab: Tab; worktree: string | null }

/** Every open worktree's tabs, in the order the worktrees were opened, after the tabs opened
 *  before any was chosen, and then the tabs of no worktree (`away`). A worktree switch changes
 *  nothing here — only which layer shows — and neither does a tab moving between them, so no pane
 *  view is remounted by one: a terminal keeps its screen. */
export function workbenchLayers(loose: readonly Tab[], worktrees: readonly string[], tabsOf: readonly (readonly Tab[])[], away: readonly Tab[] = NONE): Layer[] {
  return [
    ...loose.map((tab) => ({ tab, worktree: null })),
    ...worktrees.flatMap((worktree, i) => (tabsOf[i] ?? NONE).map((tab) => ({ tab, worktree }))),
    ...away.map((tab) => ({ tab, worktree: ELSEWHERE })),
  ]
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

function Unchosen({ layout }: { layout: Store }) {
  const first = useFleet((f) => firstWorktree(f.repos))
  // With a repo known, the first one's main checkout is about to show (`keepAWorktreeShown`): its
  // empty state already, rather than nothing meanwhile.
  return first !== null ? <Empty path={first} layout={layout} /> : <NoProjects onOpenFolder={() => void homeStore.getState().openFolder()} />
}

type Props = {
  /** The saved workspace is restored: until then an empty worktree may only be one whose tabs
   *  have not come back yet, and nothing is said about it. */
  ready: boolean
  /** Why the saved workspace could not be restored, until dismissed. */
  notice: string | null
  onDismissNotice(): void
  /** At the start of the top-left group's row: the window's left controls. */
  lead?: ReactNode
  /** At the end of the top-right group's row: the titlebar's right cluster. */
  trail?: ReactNode
  layout?: Store
}

/** The shown worktree's groups, each a tab row over a body, and the panes of every open worktree,
 *  each group's shown tab laid over its body; the rest stay mounted, hidden (`PaneLayer`: no move
 *  of a tab or a pane remounts a view). The tabs of no worktree stay mounted, never shown. With no
 *  tab to show, the empty state: under the row when the worktree has no tab, in the active group's
 *  body while Home shows. */
export default function Workbench({ ready, notice, onDismissNotice, lead, trail, layout = appLayout }: Props) {
  const worktrees = useStore(layout, (s) => s.openWorktrees())
  const loose = useStore(layout, (s) => (s.activeWorktree === null ? s.tabs : NONE))
  const tabsOf = useStore(layout, useShallow((s) => s.openWorktrees().map((w) => s.worktreeTabs(w))))
  const away = useStore(layout, (s) => s.worktreeTabs(ELSEWHERE))
  const active = useStore(layout, (s) => s.activeWorktree)
  const groups = useStore(layout, (s) => s.groups)
  const groupRoot = useStore(layout, (s) => s.groupRoot)
  const activeGroup = useStore(layout, (s) => s.activeGroup)
  const home = useStore(layout, (s) => s.activeTab === '')
  const layers = useMemo(() => workbenchLayers(loose, worktrees, tabsOf, away), [loose, worktrees, tabsOf, away])
  // Each group's body, where the tab it shows is laid.
  const bodies = useMemo(() => new Map(groupLayout(groupRoot).groups.map((g) => [g.group, below(g.box, ROW_H)])), [groupRoot])
  const placed = useMemo(() => {
    const shownBy = new Map(Object.values(groups).map((g) => [g.activeTab, g.id]))
    const split = groupRoot?.kind === 'split'
    return layers.map(({ tab, worktree }): PlacedTab => {
      const group = worktree === active ? shownBy.get(tab.id) : undefined
      const place = group !== undefined && !(home && group === activeGroup) ? (bodies.get(group) ?? null) : null
      return { tab, place, dim: place !== null && split && group !== activeGroup }
    })
  }, [layers, groups, groupRoot, active, activeGroup, home, bodies])
  // Where the empty state goes: under the row, or over the active group's body while Home shows.
  const emptyBox = groupRoot === null ? below(FULL, ROW_H) : home ? bodies.get(activeGroup) : undefined

  return (
    <div data-shell-workbench className="relative flex min-h-0 min-w-0 flex-1">
      <TabGroups layout={layout} lead={lead} trail={trail} />
      {/* Every pane of every open worktree, over the groups: each shown tab's over its group's body. */}
      <PaneLayer tabs={placed} className="pane-layer" />
      {ready && emptyBox && (
        <div className="absolute flex" style={boxStyle(emptyBox)}>
          {active === null ? <Unchosen layout={layout} /> : <Empty path={active} layout={layout} />}
        </div>
      )}
      {notice && (
        <button
          type="button"
          title="Dismiss"
          onClick={onDismissNotice}
          className="absolute top-12 left-1/2 z-10 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-md border border-status-warning-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-floating animate-in fade-in-0 slide-in-from-top-1"
        >
          <span className="truncate">{notice}</span>
          <X className="size-3 shrink-0 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

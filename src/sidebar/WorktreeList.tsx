// adapted from stablyai/orca components/sidebar/worktree-list/viewport/VirtualizedWorktreeViewport.tsx
// [322-373], components/sidebar/worktree-list/rows/SectionHeader.tsx [179-403],
// components/sidebar/worktree-list/rows/item-row.tsx [149-229], components/sidebar/ProjectHeaderActions.tsx
// and components/repo/repo-icon.tsx [130-186] (MIT, 122b8c25)
import React, { useCallback } from 'react'
import { useStore } from 'zustand'
import { ChevronDown, Folder } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { RepoNode } from '../fleet/types'
import { StatusIndicator } from './agent-glyphs'
import { activateWorktree } from './actions'
import { activePath, repoColor, sidebarOrder, worktreeStatus, type WorktreeStatus } from './model'
import { useSidebar } from './store'
import { homeStore, layoutStore, useFleet } from './upstream'
import { RepoHeaderContextMenu, RepoHeaderMenu, WorktreeContextMenu } from './menus'
import { WorktreeCard } from './WorktreeCard'

/** `PROJECT_GROUP_HEADER_BASE_PADDING` in Orca's indentation.ts. */
const HEADER_PADDING_LEFT = 10

// Why: the header's actions stay out of the title's width until the row is hovered or one of them
// has focus. Orca gates the hiding on `can-hover:` for touch screens; this app has none.
const PROJECT_HEADER_ACTIONS_CLASS_NAME = cn(
  'flex shrink-0 cursor-pointer items-center gap-0.5 self-stretch',
  'absolute right-1 top-1/2 z-10 -translate-y-1/2',
  'rounded-md bg-worktree-sidebar pl-1',
  'pointer-events-none opacity-0 transition-opacity',
  'group-hover:pointer-events-auto group-hover:opacity-100',
  'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100',
  'has-[button[data-state=open]]:pointer-events-auto has-[button[data-state=open]]:opacity-100',
)

const URGENCY: WorktreeStatus[] = ['permission', 'working', 'done', 'inactive']

/** A folded repo still says the most urgent thing inside it, so nobody waits unseen. */
function foldedStatus(repo: RepoNode): WorktreeStatus {
  const all = repo.worktrees.map((w) => worktreeStatus(w.agents))
  return URGENCY.find((s) => all.includes(s)) ?? 'inactive'
}

function RepoSection({
  repo,
  first,
  collapsed,
  active,
  tabbable,
}: {
  repo: RepoNode
  first: boolean
  collapsed: boolean
  active: string | null
  tabbable: string | null
}): React.JSX.Element {
  const toggle = useSidebar((s) => s.toggleRepo)
  const folded = collapsed ? foldedStatus(repo) : null
  const unread = collapsed && repo.worktrees.some((w) => w.unread)
  return (
    <div role="group" aria-label={repo.name} data-repo-root={repo.root}>
      <div className={cn('sticky -top-px z-20 bg-worktree-sidebar', !first && 'pt-1')}>
        <RepoHeaderContextMenu repo={repo}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed}
            data-repo-header=""
            className="group relative flex h-7 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-md pr-2 text-left outline-none transition-all focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
            style={{ paddingLeft: HEADER_PADDING_LEFT }}
            onClick={() => toggle(repo.root)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              e.stopPropagation()
              toggle(repo.root)
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
              <div className="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground">
                <Folder className="size-3.5" style={{ color: repoColor(repo.root) }} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0 truncate text-[13px] font-semibold leading-none">{repo.name}</div>
                  {collapsed && (
                    <span className="flex shrink-0 items-center gap-1" data-repo-folded="">
                      {folded !== 'inactive' && <StatusIndicator status={folded!} tooltipSide="right" />}
                      {unread && <span className="size-[6px] rounded-full bg-amber-500" aria-label="Unread" />}
                      <span className="text-[11px] font-normal leading-none tabular-nums text-muted-foreground/70">
                        {repo.worktrees.length}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div data-repo-header-actions="" className={PROJECT_HEADER_ACTIONS_CLASS_NAME}>
              <RepoHeaderMenu repo={repo} />
              <div
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                aria-hidden
              >
                <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
              </div>
            </div>
          </div>
        </RepoHeaderContextMenu>
      </div>

      {!collapsed &&
        repo.worktrees.map((w) => (
          <WorktreeContextMenu key={w.path} worktree={w}>
            <div
              role="option"
              aria-selected={w.path === active}
              aria-current={w.path === active ? 'page' : undefined}
              tabIndex={w.path === tabbable ? 0 : -1}
              data-worktree-path={w.path}
              className="group/row relative outline-none transition-[opacity,filter] duration-150 ease-out"
            >
              <WorktreeCard worktree={w} active={w.path === active} />
            </div>
          </WorktreeContextMenu>
        ))}
    </div>
  )
}

/** ↑/↓ (and Home/End) move between cards, Enter or Space shows the one with focus. */
function useListKeys() {
  return useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // A card's or header's menu is portalled out of the list, but its keys still bubble here.
    if (!e.currentTarget.contains(e.target as Node)) return
    const option = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]')
    if ((e.key === 'Enter' || e.key === ' ') && option && e.target === option) {
      e.preventDefault()
      activateWorktree(option.dataset.worktreePath!)
      return
    }
    const moves: Record<string, (i: number, n: number) => number> = {
      ArrowDown: (i, n) => Math.min(n - 1, i + 1),
      ArrowUp: (i) => Math.max(0, i - 1),
      Home: () => 0,
      End: (_, n) => n - 1,
    }
    const move = moves[e.key]
    if (!move) return
    const options = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
    if (!options.length) return
    e.preventDefault()
    if (option) return options[move(options.indexOf(option), options.length)]?.focus()
    // From a repo header: the cards below it going down, the ones above it going up.
    const target = e.target as HTMLElement
    const after = options.findIndex((o) => target.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING)
    if (e.key === 'ArrowDown') return options[after]?.focus()
    if (e.key === 'ArrowUp') return options[(after === -1 ? options.length : after) - 1]?.focus()
    options[move(0, options.length)]?.focus()
  }, [])
}

export function WorktreeList(): React.JSX.Element {
  const repos = useFleet((f) => f.repos)
  const collapsed = useSidebar((s) => s.collapsed)
  const activeWorktree = useStore(layoutStore, (s) => s.activeWorktree)
  const loading = useStore(homeStore, (s) => s.loading)
  const onKeyDown = useListKeys()
  const active = activePath(activeWorktree, repos)
  const visible = sidebarOrder(repos, collapsed)
  // One card takes Tab at a time (roving focus): the active one when it is showing, else the first.
  const tabbable = visible.find((w) => w.path === active)?.path ?? visible[0]?.path ?? null

  if (repos.length === 0) {
    return (
      <div className="min-h-0 flex-1 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground" data-sidebar-empty="">
        {loading ? null : 'Add a project to see its workspaces here.'}
      </div>
    )
  }

  return (
    <div data-worktree-sidebar-container="" className="relative min-h-0 flex-1">
      <div
        role="listbox"
        aria-label="Workspaces"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="worktree-sidebar-scrollbar h-full overflow-y-auto overflow-x-hidden pl-1 pt-px pb-2 scrollbar-sleek outline-none"
      >
        {repos.map((r, i) => (
          <RepoSection key={r.root} repo={r} first={i === 0} collapsed={collapsed.has(r.root)} active={active} tabbable={tabbable} />
        ))}
      </div>
    </div>
  )
}

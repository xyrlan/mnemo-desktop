// adapted from stablyai/orca components/sidebar/SidebarNav.tsx [88-152],
// components/sidebar/AgentDashboardSidebarEntry.tsx and components/ShortcutKeyCombo.tsx (MIT, 122b8c25)
import React, { useMemo } from 'react'
import { LayoutDashboard, ListTodo, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { AgentState } from '../fleet/types'
import { AgentQuestionIcon } from './agent-glyphs'
import { countByState } from './model'
import { run, useFleet } from './upstream'

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** Orca's key caps, sized for the search pill. Off the Mac the keys are joined with "+". */
function ShortcutKeyCombo({ keys }: { keys: string[] }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, i) => (
        <React.Fragment key={key}>
          <span className="inline-flex min-w-4 items-center justify-center rounded border border-worktree-sidebar-border/80 bg-worktree-sidebar-foreground/8 px-1 py-px text-[9px] font-medium text-worktree-sidebar-foreground/55">
            {key}
          </span>
          {!IS_MAC && i < keys.length - 1 && <span className="text-[9px] text-worktree-sidebar-foreground/45">+</span>}
        </React.Fragment>
      ))}
    </span>
  )
}

const NAV_ENTRY =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'

function NavEntry({ icon: Icon, label, onClick, children }: { icon: LucideIcon; label: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={NAV_ENTRY}>
      <Icon className="size-4 shrink-0 text-worktree-sidebar-foreground/30" strokeWidth={1.75} />
      <span className="flex-1">{label}</span>
      {children}
    </button>
  )
}

const BUCKETS: { state: Exclude<AgentState, 'idle'>; label: string; dot?: string }[] = [
  { state: 'needs-you', label: 'Needs you' },
  { state: 'working', label: 'Working', dot: 'bg-state-working' },
  { state: 'done', label: 'Done', dot: 'bg-state-done' },
]

/** Every agent's state, counted, beside the entry. Idle is left out, as in Orca by default. */
function DashboardBucketCounts(): React.JSX.Element | null {
  const repos = useFleet((f) => f.repos)
  const counts = useMemo(() => countByState(repos), [repos])
  const shown = BUCKETS.filter((b) => counts[b.state] > 0)
  if (shown.length === 0) return null
  return (
    <span className="flex items-center gap-1.5">
      {shown.map((b) => (
        <span
          key={b.state}
          aria-label={`${b.label}: ${counts[b.state]}`}
          data-bucket={b.state}
          className="inline-flex items-center gap-1 text-[10px] tabular-nums text-worktree-sidebar-foreground/55"
        >
          {b.dot ? <span className={cn('size-1.5 rounded-full', b.dot)} /> : <AgentQuestionIcon className="size-2.5" />}
          {counts[b.state]}
        </span>
      ))}
    </span>
  )
}

/** Search, Tasks and the Agent Dashboard: each hands off to the piece that owns it by action id. */
export const SidebarNav = React.memo(function SidebarNav() {
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={() => run('worktree.jump')}
        aria-label="Search workspaces"
        className="group flex w-full items-center gap-2 rounded-md bg-worktree-sidebar-foreground/5 px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8"
      >
        <Search className="size-4 shrink-0 text-worktree-sidebar-foreground/30" strokeWidth={1.75} />
        <span className="flex-1">Search</span>
        <span className="pointer-events-none hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
          <ShortcutKeyCombo keys={[IS_MAC ? '⌘' : 'Ctrl', 'J']} />
        </span>
      </button>
      <NavEntry icon={ListTodo} label="Tasks" onClick={() => run('tasks.open')} />
      <NavEntry icon={LayoutDashboard} label="Agent Dashboard" onClick={() => run('dashboard.toggle')}>
        <DashboardBucketCounts />
      </NavEntry>
    </div>
  )
})

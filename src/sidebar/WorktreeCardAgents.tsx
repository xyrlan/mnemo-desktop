// adapted from stablyai/orca components/sidebar/WorktreeCardAgents.tsx [300-404],
// components/sidebar/worktree-card-compact-agents.tsx and
// components/sidebar/worktree-card-compact-agent-row.tsx [68-310] (MIT, 122b8c25)
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { AgentNode, WorktreeNode } from '../fleet/types'
import { AgentStateDot } from './agent-glyphs'
import { activateAgent } from './actions'
import { agentDot, shortAgo, summarize, summaryGroups } from './model'
import { useSidebar } from './store'
import { layoutStore } from './upstream'

// Why: the card handles clicks as "switch to this worktree"; an agent row or the pill is its own
// target, so nothing it receives may reach the card.
const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation()

function stopActivationKeyPropagation(e: React.KeyboardEvent): void {
  // Why: the surrounding list handles Enter/Space as card activation.
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

/** The clock the rows' ages read; ticks only while there is an age to show. */
function useNow(active: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [active, everyMs])
  return now
}

/** What an agent asks of you, after its title. Every other state is said by its dot. */
function askOf(a: AgentNode): string {
  if (a.state !== 'needs-you') return ''
  return a.waitingFor === 'permission' ? 'needs permission' : 'waiting for input'
}

/** Attention first, then working, done, idle; the fleet's order within a state. */
const RANK: Record<AgentNode['state'], number> = { 'needs-you': 0, working: 1, done: 2, idle: 3 }
const byAttention = (agents: readonly AgentNode[]) => [...agents].sort((a, b) => RANK[a.state] - RANK[b.state])

/** Keeps opened content mounted so it can collapse with the grid-row transition. */
function CompactAgentExpansion({ expanded, children }: { expanded: boolean; children: React.ReactNode }): React.JSX.Element {
  const renderedRef = useRef(expanded)
  if (expanded) renderedRef.current = true
  return (
    <div
      className={cn('compact-agent-expansion-grid', expanded && 'compact-agent-expansion-grid-expanded')}
      aria-hidden={!expanded}
      inert={!expanded}
    >
      <div className="min-h-0 min-w-0 overflow-x-visible overflow-y-clip">
        {(expanded || renderedRef.current) && (
          <div className="compact-agent-expansion-content flex flex-col gap-0.5 pt-0.5">{children}</div>
        )}
      </div>
    </div>
  )
}

function CompactAgentSummaryButton({
  agents,
  expanded,
  onToggle,
}: {
  agents: readonly AgentNode[]
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const subject = `${agents.length} agents`
  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      onToggle()
    },
    [onToggle],
  )
  return (
    <button
      type="button"
      draggable={false}
      className={cn(
        'compact-agent-summary-button group/agent-summary flex h-6 w-full min-w-0 items-center gap-1 rounded-sm',
        'px-1 text-left text-[11px] leading-none text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
        'hover:bg-worktree-sidebar-accent/55 dark:hover:bg-worktree-sidebar-foreground/[0.035]',
        // Why: expanded is a tree header inside the card; only the collapsed pill has a surface.
        expanded ? 'compact-agent-summary-button-expanded' : 'border border-worktree-sidebar-border/70 bg-worktree-sidebar-accent/35',
      )}
      aria-label={expanded ? `Collapse ${subject}` : `Expand ${summarize(agents)}`}
      aria-expanded={expanded}
      onClick={handleToggle}
      onKeyDown={stopActivationKeyPropagation}
    >
      {expanded ? (
        <span className="min-w-0 flex-1 truncate px-1 font-medium text-muted-foreground">{subject}</span>
      ) : (
        <>
          {/* Orca overlaps each state's agent icons here; every agent here is Claude, so the
              group says how many instead. */}
          <span className="flex shrink-0 items-center gap-1 overflow-hidden" aria-hidden>
            {summaryGroups(agents).map((g) => (
              <span
                key={g.state}
                data-summary-group={g.state}
                className="inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-sm bg-worktree-sidebar/70 px-1 py-0.5"
              >
                <AgentStateDot state={g.state} tooltipSide="right" />
                <span className="shrink-0 pl-0.5 text-[10px] tabular-nums text-muted-foreground/70">{g.count}</span>
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate px-0.5 text-muted-foreground/70">{subject}</span>
        </>
      )}
      <ChevronDown className={cn('size-3 shrink-0 transition-transform duration-150', !expanded && '-rotate-90')} aria-hidden />
    </button>
  )
}

const CompactAgentRow = React.memo(function CompactAgentRow({
  agent,
  worktree,
  now,
  isFocusedPane,
}: {
  agent: AgentNode
  worktree: string
  now: number
  isFocusedPane: boolean
}) {
  const ask = askOf(agent)
  const rowTitle = `${agent.title}${ask ? ` - ${ask}` : ''}`
  const activate = () => activateAgent(worktree, agent.paneId)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      className={cn(
        'compact-agent-row group/compact-agent-row min-w-0 overflow-hidden cursor-pointer rounded-sm px-1 text-[11px] leading-none',
        'text-muted-foreground worktree-agent-row-hover',
        'flex h-6 items-center gap-1',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
        isFocusedPane && 'bg-worktree-sidebar-accent',
      )}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        activate()
      }}
      data-agent-session={agent.sessionId}
      data-focused-agent-pane={isFocusedPane ? 'true' : undefined}
      aria-label={`${rowTitle}, ${shortAgo(agent.since, now)}`}
    >
      <AgentStateDot state={agentDot(agent)} tooltipSide="right" />
      <span className="min-w-0 flex-1 truncate" title={rowTitle}>
        {/* Why: the selected-row fill would wash out the dimmed text, so lift it when focused. */}
        <span className={isFocusedPane ? 'text-foreground' : 'text-muted-foreground/90'}>{agent.title}</span>
        {ask && <span className={isFocusedPane ? 'text-foreground/70' : 'text-muted-foreground/65'}> - {ask}</span>}
      </span>
      <span className={cn('shrink-0 text-[10px] tabular-nums', isFocusedPane ? 'text-foreground/70' : 'text-muted-foreground/60')}>
        {shortAgo(agent.since, now)}
      </span>
    </div>
  )
})

/** A card's agents, compact: one row each, or, past one, a pill that expands into the rows. */
export function WorktreeCardAgents({ worktree, className }: { worktree: WorktreeNode; className?: string }): React.JSX.Element | null {
  const agents = worktree.agents
  const expanded = useSidebar((s) => s.expandedAgents.has(worktree.path))
  const toggle = useSidebar((s) => s.toggleAgents)
  const focusedPane = useStore(layoutStore, (s) => s.tabs.find((t) => t.id === s.activeTab)?.focused ?? null)
  const now = useNow(agents.length > 0)
  if (agents.length === 0) return null
  const rows = byAttention(agents).map((a) => (
    <CompactAgentRow key={a.sessionId} agent={a} worktree={worktree.path} now={now} isFocusedPane={a.paneId !== null && a.paneId === focusedPane} />
  ))
  return (
    <div
      className={cn('mt-1 flex flex-col gap-0.5', className)}
      onClick={stopBubble}
      onDoubleClick={stopBubble}
      onMouseDown={stopBubble}
      onPointerDown={stopBubble}
      role="group"
      aria-label="Agents"
      data-compact-agent-list="true"
    >
      {agents.length > 1 ? (
        <div className={cn('compact-agent-summary-panel', expanded && 'compact-agent-summary-panel-expanded')}>
          <CompactAgentSummaryButton agents={agents} expanded={expanded} onToggle={() => toggle(worktree.path)} />
          <CompactAgentExpansion expanded={expanded}>{rows}</CompactAgentExpansion>
        </div>
      ) : (
        rows
      )}
    </div>
  )
}

import React from 'react'
import { Brain } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '../layout/app-store'
import { useFleet } from '../fleet/store'
import { getMemoryFeed } from '../memory/client'
import { learnedClient } from '../learned/app-store'
import { MemoryPanel } from './MemoryPanel'
import { RightSidebar, type ActivityItem } from './RightSidebar'
import { createMemoryStore, targetOf, type LayoutView } from './memory'
import { mountInSlot } from './shell'

/** The single live panel store: what it read survives the sidebar closing and opening. */
const memory = createMemoryStore({
  feed: getMemoryFeed,
  project: (cwd) => learnedClient.project(cwd),
  step: (step, target, keys) => learnedClient.step(step, target, keys),
})

function LiveMemoryPanel(): React.JSX.Element {
  const layout = useApp(
    useShallow((s): LayoutView => ({ activeWorktree: s.activeWorktree, tabs: s.tabs, activeTab: s.activeTab, panes: s.panes })),
  )
  const repos = useFleet((f) => f.repos)
  const target = targetOf(layout, repos)
  // When the focused session's agent changes state, rules may have fired or pages been learned.
  let stamp: string | null = null
  if (target?.sessionId) {
    for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) if (a.sessionId === target.sessionId) stamp = `${a.state}:${a.since}`
  }
  return <MemoryPanel store={memory} target={target} stamp={stamp} />
}

/** The right sidebar's tabs; Explorer, Source control and Checks join in a later wave. */
export const ITEMS: ActivityItem[] = [{ id: 'memory', icon: Brain, title: 'Memory', panel: LiveMemoryPanel }]

function LiveRightSidebar(): React.JSX.Element | null {
  return <RightSidebar items={ITEMS} />
}

const unmount = mountInSlot('right-sidebar', LiveRightSidebar)
import.meta.hot?.dispose(unmount)

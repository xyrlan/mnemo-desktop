// adapted from stablyai/orca src/renderer/src/components/tab-bar/tab-bar-surface.tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, TooltipProvider } from '@/ui'
import { cn } from '@/ui/cn'
import { store, useApp } from '../layout/app-store'
import type { Pane, Tab } from '../layout/store'
import { leaves } from '../layout/tree'
import { paneName } from '../layout/tabs'
import { useMission } from '../mission/app-store'
import { useHome } from '../home/app-store'
import { useFleet } from '../fleet/store'
import { run } from '../actions/registry'
import { dropIndicatorFor, fleetAgents, reorderTabs, tabAgent, tabUnread } from './model'
import { seenAt, seenStore, useSeen } from './seen'
import SortableTab, { ViewIcon } from './SortableTab'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX } from './pointer-activation'
import './tabs.css'

/** Moves tab `from` to where `to` is in the worktree shown. The layout store has no reorder of
 *  its own; `tabs` is the shown worktree's, so writing it is the whole move. */
export function moveTab(from: string, to: string) {
  store.setState((s) => {
    const tabs = reorderTabs(s.tabs, from, to)
    return tabs === s.tabs ? {} : { tabs }
  })
}

/** Marks the tab left and the tab shown as seen whenever the shown tab changes: what happened in
 *  a tab while it was on screen is not news once you leave it. */
function useMarkSeen(activeTab: string) {
  const prev = useRef(activeTab)
  useEffect(() => {
    seenStore.getState().mark([prev.current, activeTab])
    prev.current = activeTab
  }, [activeTab])
}

type Overflow = { hasOverflow: boolean; canScrollStart: boolean; canScrollEnd: boolean }
const NO_OVERFLOW: Overflow = { hasOverflow: false, canScrollStart: false, canScrollEnd: false }

/** Whether the strip hides tabs, and on which side, kept current as it scrolls and resizes. */
function useOverflow(ref: React.RefObject<HTMLDivElement | null>, count: number): Overflow {
  const [state, setState] = useState<Overflow>(NO_OVERFLOW)
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    const hasOverflow = max > 1
    const next = { hasOverflow, canScrollStart: hasOverflow && el.scrollLeft > 1, canScrollEnd: hasOverflow && el.scrollLeft < max - 1 }
    setState((s) => (s.hasOverflow === next.hasOverflow && s.canScrollStart === next.canScrollStart && s.canScrollEnd === next.canScrollEnd ? s : next))
  }, [ref])
  useLayoutEffect(measure, [measure, count])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro?.disconnect()
    }
  }, [ref, measure])
  return state
}

/** A tab named by its own name, else by what runs in its focused pane. */
function titleOf(tab: Tab, panes: Record<number, Pane>, snap: Parameters<typeof paneName>[1], home: Parameters<typeof paneName>[2]): string {
  return tab.name || paneName(panes[tab.focused], snap, home)
}

// adapted from stablyai/orca src/renderer/src/components/tab-bar/TabDragPreview.tsx
function TabDragPreview({ title, view }: { title: string; view: string }) {
  return (
    <div className="pointer-events-none flex h-full w-full items-center gap-1.5 rounded-sm border border-border bg-accent px-2 text-xs text-foreground shadow-md">
      <span className="inline-flex shrink-0">
        <ViewIcon view={view} className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{title}</span>
    </div>
  )
}

/** The shown worktree's tabs, for the titlebar: the active one barred, unread ones washed, each
 *  led by its agent's state, closed on hover, dragged to reorder; "+" opens a terminal. */
export default function TabStrip({ onNew = () => run('tab.new') }: { onNew?: () => void }) {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const snap = useMission((s) => s.snapshot)
  const home = useHome((s) => s.snapshot)
  const repos = useFleet((f) => f.repos)
  const agents = useMemo(() => fleetAgents(repos), [repos])
  const seen = useSeen((s) => s)
  useMarkSeen(activeTab)

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE_PX } }))
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs])
  const stripRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(stripRef, tabs.length)

  // Keeps the tab being shown in view when it changes (a new tab lands at the end).
  useEffect(() => {
    const all = stripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
    const el = [...all].find((e) => e.dataset.tabId === activeTab)
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeTab, tabs.length])

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id))
  const onDragOver = (e: DragOverEvent) => setOver(e.over ? String(e.over.id) : null)
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) moveTab(String(e.active.id), String(e.over.id))
    setDragging(null)
    setOver(null)
  }
  const onDragCancel = () => {
    setDragging(null)
    setOver(null)
  }

  const scroll = (dir: 'start' | 'end') => {
    const el = stripRef.current
    if (!el) return
    el.scrollBy({ left: (dir === 'start' ? -1 : 1) * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' })
  }

  const draggedTab = dragging ? tabs.find((t) => t.id === dragging) : undefined
  const chevron = 'mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35'

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden" data-ui data-testid="workbench-tabs" role="tablist" aria-label="Tabs">
        {overflow.hasOverflow && (
          <Button variant="ghost" size="icon-xs" className={chevron} aria-label="Scroll tabs left" disabled={!dragging && !overflow.canScrollStart} onClick={() => scroll('start')}>
            <ChevronLeft className="size-3.5" />
          </Button>
        )}
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel} autoScroll={false}>
          {/* No sorting animation: tabs stay anchored during a drag, only the insertion bar moves. */}
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="group/tab-strip relative flex min-h-0 max-w-full min-w-0 flex-[0_1_auto]">
              <div
                ref={stripRef}
                className={cn(
                  'workbench-tab-strip flex h-full max-w-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden',
                  tabs.length > 0 && 'border-r border-border/70',
                  overflow.canScrollStart && 'workbench-tab-strip--fade-start',
                  overflow.canScrollEnd && 'workbench-tab-strip--fade-end',
                )}
              >
                {tabs.map((t, i) => {
                  const agent = tabAgent(t, agents)
                  const isActive = t.id === activeTab
                  return (
                    <SortableTab
                      key={t.id}
                      id={t.id}
                      title={titleOf(t, panes, snap, home)}
                      view={panes[t.focused]?.view ?? 'terminal'}
                      panes={leaves(t.root).length}
                      active={isActive}
                      state={agent?.state ?? null}
                      unread={tabUnread(t, agents, isActive, seenAt(seen, t.id))}
                      hasTabsToRight={i < tabs.length - 1}
                      dropIndicator={dropIndicatorFor(ids, dragging, over, t.id)}
                      onActivate={(id) => store.getState().goToTab(store.getState().tabs.findIndex((x) => x.id === id))}
                      onClose={(id) => void store.getState().closeTab(id)}
                      onRename={(id, name) => store.getState().renameTab(id, name)}
                    />
                  )
                })}
              </div>
            </div>
          </SortableContext>
          {/* The source tab stays in place and the strip clips it; the ghost follows the cursor
              across the whole window from a document-level portal. */}
          <DragOverlay dropAnimation={null}>
            {draggedTab ? <TabDragPreview title={titleOf(draggedTab, panes, snap, home)} view={panes[draggedTab.focused]?.view ?? 'terminal'} /> : null}
          </DragOverlay>
        </DndContext>
        {overflow.hasOverflow && (
          <Button variant="ghost" size="icon-xs" className={chevron} aria-label="Scroll tabs right" disabled={!dragging && !overflow.canScrollEnd} onClick={() => scroll('end')}>
            <ChevronRight className="size-3.5" />
          </Button>
        )}
        <button
          type="button"
          className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          title="New terminal (⌘T)"
          aria-label="New tab"
          onClick={onNew}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </TooltipProvider>
  )
}

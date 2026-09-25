// adapted from stablyai/orca src/renderer/src/components/tab-bar/tab-bar-surface.tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { store as appStore } from '../layout/app-store'
import { ELSEWHERE, type Pane, type Store, type Tab } from '../layout/store'
import { leaves } from '../layout/tree'
import { paneName } from '../layout/tabs'
import { useMission } from '../mission/app-store'
import { useHome } from '../home/app-store'
import { useFleet } from '../fleet/store'
import { useDrag } from '../chrome/drag'
import { fleetAgents, tabAgent, tabUnread, type DropIndicator } from './model'
import { seenAt, useSeen } from './seen'
import SortableTab, { ViewIcon } from './SortableTab'
import Elsewhere, { strayTab } from './Elsewhere'
import NewTabMenu, { newTab, type NewTabKind } from './NewTabMenu'
import './tabs.css'

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
export function titleOf(tab: Tab, panes: Record<number, Pane>, snap: Parameters<typeof paneName>[1], home: Parameters<typeof paneName>[2]): string {
  return tab.name || paneName(panes[tab.focused], snap, home)
}

/** The insertion bar of a row with a drop pending before its tab at `slot`: on that tab's left,
 *  or on the last tab's right when the slot is past them all. */
export function slotIndicator(ids: readonly string[], slot: number | null, id: string): DropIndicator {
  if (slot === null || ids.length === 0) return null
  if (slot < ids.length) return ids[slot] === id ? 'left' : null
  return ids[ids.length - 1] === id ? 'right' : null
}

const NONE: string[] = []
const NO_TABS: Tab[] = []

type Props = {
  layout?: Store
  /** The group whose row this is; null while the worktree has no tab (the row holds "+" alone). */
  group: string | null
  /** A tab dragged over this row would land before its tab at this slot (TabGroups). */
  slot?: number | null
  /** Draw the menu of tabs of no open worktree (one row does: the active group's). */
  elsewhere?: boolean
  onNew?: (kind: NewTabKind) => void
}

/** One group's tab row: its tabs in their order, the one it shows barred, unread ones washed,
 *  each led by its agent's state, closed on hover or by a middle click, a preview in italics
 *  (a double click keeps it), dragged to reorder or to another group (TabGroups); "+" opens a
 *  terminal or a browser in this group. The tabs of no worktree are never among them: a menu at
 *  the end of the active group's row lists them, to bring one here. */
export default function TabStrip({ layout = appStore, group, slot = null, elsewhere = false, onNew = newTab }: Props) {
  const ids = useStore(layout, (s) => (group !== null ? s.groups[group]?.tabs : undefined) ?? NONE)
  const all = useStore(layout, (s) => s.tabs)
  const tabs = useMemo(() => {
    const byId = new Map(all.map((t) => [t.id, t]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  }, [ids, all])
  // The tab this group shows; none in the active group while Home shows.
  const shown = useStore(layout, (s) => (group === null || (s.activeTab === '' && s.activeGroup === group) ? '' : (s.groups[group]?.activeTab ?? '')))
  const away = useStore(layout, (s) => (elsewhere ? (s.parked[ELSEWHERE]?.tabs ?? NO_TABS) : NO_TABS))
  const panes = useStore(layout, (s) => s.panes)
  const snap = useMission((s) => s.snapshot)
  const home = useHome((s) => s.snapshot)
  const repos = useFleet((f) => f.repos)
  const agents = useMemo(() => fleetAgents(repos), [repos])
  const seen = useSeen((s) => s)
  // A pane bar dragged over this row: the slot it would become a tab at.
  const paneSlot = useDrag((s) => (s.row !== null && s.row.group === group ? s.row.slot : null))
  const at = slot ?? paneSlot

  const stripRef = useRef<HTMLDivElement>(null)
  const overflow = useOverflow(stripRef, tabs.length)

  // Keeps the tab being shown in view when it changes (a new tab lands at the end).
  useEffect(() => {
    const all = stripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
    const el = [...all].find((e) => e.dataset.tabId === shown)
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [shown, tabs.length])

  const scroll = (dir: 'start' | 'end') => {
    const el = stripRef.current
    if (!el) return
    el.scrollBy({ left: (dir === 'start' ? -1 : 1) * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' })
  }
  // The "+" of a group's own row opens in that group.
  const create = (kind: NewTabKind) => {
    if (group !== null) layout.getState().focusGroup(group)
    onNew(kind)
  }

  const chevron = 'mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35'
  const act = () => layout.getState()

  return (
    <div className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden" data-ui data-testid="workbench-tabs" role="tablist" aria-label="Tabs">
      {overflow.hasOverflow && (
        <Button variant="ghost" size="icon-xs" className={chevron} aria-label="Scroll tabs left" disabled={!overflow.canScrollStart} onClick={() => scroll('start')}>
          <ChevronLeft className="size-3.5" />
        </Button>
      )}
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
            const isShown = t.id === shown
            return (
              <SortableTab
                key={t.id}
                id={t.id}
                group={group!}
                title={titleOf(t, panes, snap, home)}
                view={panes[t.focused]?.view ?? 'terminal'}
                panes={leaves(t.root).length}
                active={isShown}
                preview={t.preview}
                state={agent?.state ?? null}
                unread={tabUnread(t, agents, isShown, seenAt(seen, t.id))}
                hasTabsToRight={i < tabs.length - 1}
                dropIndicator={slotIndicator(ids, at, t.id)}
                canSplit={tabs.length > 1}
                onActivate={(id) => act().activateTab(id)}
                onClose={(id) => void act().closeTab(id)}
                onRename={(id, name) => act().renameTab(id, name)}
                onKeep={(id) => act().keepTab(id)}
                onMoveToSplit={(id, side) => act().moveTab(id, { group: group!, side })}
              />
            )
          })}
        </div>
      </div>
      {overflow.hasOverflow && (
        <Button variant="ghost" size="icon-xs" className={chevron} aria-label="Scroll tabs right" disabled={!overflow.canScrollEnd} onClick={() => scroll('end')}>
          <ChevronRight className="size-3.5" />
        </Button>
      )}
      <NewTabMenu onNew={create} />
      {elsewhere && <Elsewhere tabs={away.map((t) => strayTab(t, titleOf(t, panes, snap, home), panes[t.focused]))} onBring={(id) => act().bringTab(id)} />}
    </div>
  )
}

// adapted from stablyai/orca src/renderer/src/components/tab-bar/TabDragPreview.tsx
/** The ghost that follows the pointer while a tab is dragged. */
export function TabDragPreview({ title, view, preview }: { title: string; view: string; preview?: boolean }) {
  return (
    <div className="pointer-events-none flex h-full w-full items-center gap-1.5 rounded-sm border border-border bg-accent px-2 text-xs text-foreground shadow-md">
      <span className="inline-flex shrink-0">
        <ViewIcon view={view} className="h-3.5 w-3.5" />
      </span>
      <span className={cn('truncate', preview && 'italic')}>{title}</span>
    </div>
  )
}

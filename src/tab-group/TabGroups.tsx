// adapted from stablyai/orca src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx,
// TabGroupPanel.tsx, useTabDragSplit.ts, tab-drag-pointer.ts, TabPaneColumnSplitDragOverlay.tsx and
// TabGroupDropOverlay.tsx (MIT, 122b8c25)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core'
import { TooltipProvider } from '@/ui'
import { cn } from '@/ui/cn'
import type { State, Store, WorktreeLayout } from '../layout/store'
import Divider from '../chrome/Divider'
import { boxStyle } from '../chrome/geometry'
import { useMission } from '../mission/app-store'
import { useHome } from '../home/app-store'
import TabStrip, { TabDragPreview, titleOf } from '../tabs/TabStrip'
import type { NewTabKind } from '../tabs/NewTabMenu'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX } from '../tabs/pointer-activation'
import { seenStore } from '../tabs/seen'
import { cornerGroups, groupLayout, type GroupPlace } from './layout'
import { halfOf, resolveTabDrop, type GroupRects, type Point, type Rect, type TabDrop } from './drop'
import './tab-group.css'

/** The shown worktree's layout, as the store's moves take it. */
const shownLayout = (s: State): WorktreeLayout => ({ tabs: s.tabs, activeTab: s.activeTab, groups: s.groups, groupRoot: s.groupRoot, activeGroup: s.activeGroup })

/** The tabs on screen: every group's shown tab, but the active group's while Home shows. */
const shownTabs = (s: State): string[] =>
  Object.values(s.groups)
    .filter((g) => !(s.activeTab === '' && g.id === s.activeGroup))
    .map((g) => g.activeTab)

/** Marks the tabs that leave the screen and those that come on as seen whenever that set changes:
 *  what happened in a tab while it was on screen is not news once you leave it. */
function useMarkSeen(layout: Store) {
  const shown = useStore(layout, useShallow(shownTabs))
  const prev = useRef(shown)
  useEffect(() => {
    seenStore.getState().mark([...prev.current, ...shown])
    prev.current = shown
  }, [shown])
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Every group's panel, row, body and tabs on screen, when a drag starts. */
function measureGroups(root: ParentNode | null): GroupRects[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('[data-tab-group-id]')].flatMap((panel) => {
    const row = panel.querySelector('[data-tab-group-strip-id]')
    const body = panel.querySelector('[data-tab-group-body-id]')
    if (!row || !body) return []
    const tabs = [...row.querySelectorAll<HTMLElement>('[data-tab-id]')].map((t) => ({ id: t.dataset.tabId!, rect: rectOf(t) }))
    return [{ group: panel.dataset.tabGroupId!, panel: rectOf(panel), row: rectOf(row), body: rectOf(body), tabs }]
  })
}

/** Where the pointer is during a tab drag. The tabs stay anchored (no transform) while the ghost
 *  follows the pointer, so the dragged rect never tracks it: the press plus how far it moved. */
function pointerOf(e: { activatorEvent: Event | null; delta: { x: number; y: number } }): Point | null {
  const a = e.activatorEvent as { clientX?: unknown; clientY?: unknown } | null
  return a && typeof a.clientX === 'number' && typeof a.clientY === 'number' ? { x: a.clientX + e.delta.x, y: a.clientY + e.delta.y } : null
}

const sameDrop = (a: TabDrop | undefined, b: TabDrop | undefined) => JSON.stringify(a) === JSON.stringify(b)

type Hover = { drop: TabDrop; rect: Rect }

/** A tab drag across every row of the worktree shown: onto a row at the insertion bar, onto the
 *  outer band of a group's body (a new group on that side), or onto the middle of another
 *  group's body (the end of its row). Where it lands comes from where the pointer is, against the
 *  groups as measured when the drag started, and only a drop that changes the layout shows. */
function useTabDrag(layout: Store, root: React.RefObject<HTMLDivElement | null>) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE_PX } }))
  const [dragging, setDragging] = useState<string | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const rects = useRef<GroupRects[]>([])

  const resolve = (e: DragMoveEvent | DragEndEvent) => {
    const p = pointerOf(e)
    const hit = p && resolveTabDrop(shownLayout(layout.getState()), rects.current, String(e.active.id), p)
    if (!hit) return null
    const g = rects.current.find((r) => r.group === hit.drop.group)!
    const rect = hit.drop.kind === 'split' ? halfOf(g.panel, hit.drop.side) : g.body
    return { ...hit, rect }
  }
  const clear = () => {
    setDragging(null)
    setHover(null)
    rects.current = []
  }
  return {
    sensors,
    dragging,
    hover,
    onDragStart(e: DragStartEvent) {
      rects.current = measureGroups(root.current)
      setDragging(String(e.active.id))
    },
    onDragMove(e: DragMoveEvent) {
      const next = resolve(e)
      setHover((prev) => (sameDrop(prev?.drop, next?.drop) ? prev : next && { drop: next.drop, rect: next.rect }))
    },
    onDragEnd(e: DragEndEvent) {
      const hit = resolve(e)
      clear()
      if (hit) layout.getState().moveTab(String(e.active.id), hit.to)
    },
    onDragCancel: clear,
  }
}

/** Shades where a dragged tab lands in a body: the half a new group takes on an edge, labelled
 *  "New split", or the whole body of the group it joins. Above every pane, in the page's corner. */
function DropOverlay({ hover }: { hover: Hover }) {
  const { left, top, width, height } = hover.rect
  const side = hover.drop.kind === 'split' ? hover.drop.side : null
  return createPortal(
    <div aria-hidden className="tab-drop-overlay" data-drop={side ?? 'join'} style={{ left, top, width, height }}>
      {side && <span className="tab-drop-overlay-label">New split</span>}
    </div>,
    document.body,
  )
}

/** The ghost of the tab being dragged. */
function DraggedTab({ layout, id }: { layout: Store; id: string }) {
  const tab = useStore(layout, (s) => s.tabs.find((t) => t.id === id))
  const pane = useStore(layout, (s) => (tab ? s.panes[tab.focused] : undefined))
  const panes = useStore(layout, (s) => s.panes)
  const snap = useMission((s) => s.snapshot)
  const home = useHome((s) => s.snapshot)
  return tab ? <TabDragPreview title={titleOf(tab, panes, snap, home)} view={pane?.view ?? 'terminal'} preview={tab.preview} /> : null
}

type RowProps = {
  layout: Store
  group: string | null
  lead?: ReactNode
  trail?: ReactNode
  slot?: number | null
  elsewhere: boolean
  onNew?: (kind: NewTabKind) => void
}

/** A group's tab row: the window's left controls first in the top-left one, its tabs, and the
 *  titlebar's right cluster last in the top-right one. A press on the row's own space (not a tab,
 *  whose release shows it) makes the group active. */
function Row({ layout, group, lead, trail, slot, elsewhere, onNew }: RowProps) {
  return (
    <div className="tab-group-row" data-tab-group-strip-id={group ?? undefined}>
      {lead}
      <div
        className="flex min-w-0 flex-1 items-stretch"
        onPointerDown={(e) => {
          if (group !== null && !(e.target as Element).closest?.('[data-tab-id]')) layout.getState().focusGroup(group)
        }}
      >
        <TabStrip layout={layout} group={group} slot={slot} elsewhere={elsewhere} onNew={onNew} />
      </div>
      {trail}
    </div>
  )
}

type Props = {
  layout: Store
  /** At the start of the top-left group's row: the window's left controls, while the left
   *  sidebar is closed. */
  lead?: ReactNode
  /** At the end of the top-right group's row: the titlebar's right cluster. */
  trail?: ReactNode
  onNew?: (kind: NewTabKind) => void
}

/** The shown worktree's groups as Orca draws them: each a tab row over a body, placed by the split
 *  tree with a seam between each pair that resizes it. While split, the active group's row carries
 *  an accent and the others dim a little. The bodies are empty: the workbench lays each shown tab
 *  over its group's body from outside, so nothing here remounts a pane view. With no tab, one row
 *  holds the "+". */
export default function TabGroups({ layout, lead, trail, onNew }: Props) {
  const root = useStore(layout, (s) => s.groupRoot)
  const activeGroup = useStore(layout, (s) => s.activeGroup)
  const place = useMemo(() => groupLayout(root), [root])
  const { topLeft, topRight } = cornerGroups(place)
  const split = root?.kind === 'split'
  const ref = useRef<HTMLDivElement>(null)
  const drag = useTabDrag(layout, ref)
  useMarkSeen(layout)

  const panel = (p: GroupPlace) => (
    <div key={p.group} data-tab-group-id={p.group} className={cn('tab-group', p.group === activeGroup && 'is-active')} style={boxStyle(p.box)}>
      <Row
        layout={layout}
        group={p.group}
        lead={p.group === topLeft ? lead : undefined}
        trail={p.group === topRight ? trail : undefined}
        slot={drag.hover?.drop.kind === 'row' && drag.hover.drop.group === p.group ? drag.hover.drop.slot : null}
        elsewhere={p.group === activeGroup}
        onNew={onNew}
      />
      <div className="tab-group-body" data-tab-group-body-id={p.group} />
    </div>
  )

  return (
    <TooltipProvider delayDuration={400}>
      <DndContext sensors={drag.sensors} onDragStart={drag.onDragStart} onDragMove={drag.onDragMove} onDragEnd={drag.onDragEnd} onDragCancel={drag.onDragCancel} autoScroll={false}>
        <div ref={ref} className={cn('tab-groups', split && 'is-split')} data-tab-groups="">
          {root ? (
            place.groups.map(panel)
          ) : (
            <div className="tab-group is-bare">
              <Row layout={layout} group={null} lead={lead} trail={trail} elsewhere onNew={onNew} />
            </div>
          )}
          {place.seams.map((d) => (
            <Divider key={`${d.dir}:${d.path.join('')}`} d={d} root={ref} onRatio={(path, ratio) => layout.getState().setGroupRatio(path, ratio)} />
          ))}
        </div>
        {/* The dragged tab stays in its row; its ghost follows the pointer across the window. */}
        <DragOverlay dropAnimation={null}>{drag.dragging ? <DraggedTab layout={layout} id={drag.dragging} /> : null}</DragOverlay>
        {drag.hover && drag.hover.drop.kind !== 'row' && <DropOverlay hover={drag.hover} />}
      </DndContext>
    </TooltipProvider>
  )
}

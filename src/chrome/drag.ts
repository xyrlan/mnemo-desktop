import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PaneId, Rect, Side } from '../layout/tree'
import { rowSlot } from '../tab-group/drop'

/** Which region of a target rect a drop would land in. */
export type Zone = Side | 'center'

/** A slot of a group's tab row: before its tab at `slot` (the row's length: after the last). */
export type RowSlot = { group: string; slot: number }

/** A pane bar being dragged: `from` once the pointer has moved past THRESHOLD, `over` the
 *  pane under it (null over a divider, a tab row, a pane of another tab, or its own pane), and
 *  `zone` the region of `over` the pointer is in (null whenever `over` is null). `row`: the tab
 *  row slot it is over, when the pane may become a tab of its own there. */
export type DragState = { from: PaneId | null; over: PaneId | null; zone: Zone | null; row: RowSlot | null }

export const dragStore = createStore<DragState>(() => ({ from: null, over: null, zone: null, row: null }))
export const useDrag = <T,>(sel: (s: DragState) => T) => useStore(dragStore, sel)

/** What releasing over `zone` of pane `to` does: the center swaps the two panes, an edge moves
 *  `from` to that side of `to`. */
export function dropPane(
  panes: { swapPanes(a: PaneId, b: PaneId): void; movePane(from: PaneId, to: PaneId, side: Side): void },
  from: PaneId,
  to: PaneId,
  zone: Zone,
): void {
  if (zone === 'center') panes.swapPanes(from, to)
  else panes.movePane(from, to, zone)
}

/** Pixels the pointer travels before a press on the bar becomes a drag (a click only focuses). */
export const THRESHOLD = 4

/** The fraction of a side's length, from that edge, that counts as its drop zone. */
const EDGE = 0.25

/** Which region of `rect` the point falls in: the outer 25% of each side is that side, the
 *  middle is `center`, outside the rect is null. Ties (near a corner) resolve to whichever
 *  edge the point is proportionally closest to, checked in left/right/up/down order. A
 *  rect with no area (not yet laid out) cannot be divided, so it is `center` throughout —
 *  the same place a drop would have landed before zones existed. */
export function dropZone(x: number, y: number, rect: Rect): Side | 'center' | null {
  if (rect.w <= 0 || rect.h <= 0) return 'center'
  if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) return null
  const left = (x - rect.x) / rect.w
  const right = 1 - left
  const up = (y - rect.y) / rect.h
  const down = 1 - up
  const min = Math.min(left, right, up, down)
  if (min >= EDGE) return 'center'
  return min === left ? 'left' : min === right ? 'right' : min === up ? 'up' : 'down'
}

/** The `.pane[data-pane]` element an event happened over, from its target. Native child
 *  webviews (browser panes) swallow pointer events, so over those only their bar counts. */
function paneElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.pane[data-pane]') : null
}

/** The pane an event happened over, from its target. */
export function paneUnder(target: EventTarget | null): PaneId | null {
  const el = paneElement(target)
  const id = el ? Number(el.dataset.pane) : NaN
  return Number.isFinite(id) ? id : null
}

/** The tab a pane element is drawn for (`data-tab`); undefined outside the workbench. */
const tabOf = (el: Element | null) => el?.closest<HTMLElement>('[data-tab]')?.dataset.tab

/** The slot of a tab row a point at `x` falls in, from its tabs on screen. */
const rowSlotAt = (row: Element, x: number) => rowSlot([...row.querySelectorAll<HTMLElement>('[data-tab-id]')].map((t) => t.getBoundingClientRect()), x)

type Target = { over: PaneId | null; zone: Zone | null; row: RowSlot | null }

/** What an event is over, from the DOM: a tab row's slot (when `rows` accept the pane), else a
 *  pane other than `id` of the same tab, and the zone within it. Other tabs' panes, shown in
 *  other groups, are never a target: only a terminal tab splits, inside itself. */
function resolveTarget(ev: MouseEvent, id: PaneId, rows: boolean): Target {
  const target = ev.target instanceof Element ? ev.target : null
  const row = rows ? target?.closest<HTMLElement>('[data-tab-group-strip-id]') : null
  const group = row?.dataset.tabGroupStripId
  if (row && group) return { over: null, zone: null, row: { group, slot: rowSlotAt(row, ev.clientX) } }
  const el = paneElement(target)
  const rawId = el ? Number(el.dataset.pane) : NaN
  const under = Number.isFinite(rawId) ? rawId : null
  const own = document.querySelector(`.pane[data-pane="${id}"]`)
  const over = under === id || (own && tabOf(el) !== tabOf(own)) ? null : under
  if (over === null || !el) return { over, zone: null, row: null }
  const r = el.getBoundingClientRect()
  return { over, zone: dropZone(ev.clientX, ev.clientY, { x: r.left, y: r.top, w: r.width, h: r.height }), row: null }
}

/** Follows the pointer from a mousedown on pane `id`'s bar until release, then calls `drop`
 *  with the pane and zone it was let go over — never for its own pane, nothing, or a cancel.
 *  With `rows`, a group's tab row is a target too, and letting go over it calls `rows.detach`
 *  with the group and the slot (a pane of a tab with others becomes a tab of its own there).
 *  Listens in the capture phase so xterm, which handles its own mouse events, cannot hide the
 *  moves. Escape cancels. Returns a cancel function. */
export function startPaneDrag(
  id: PaneId,
  start: { clientX: number; clientY: number },
  drop: (from: PaneId, to: PaneId, zone: Zone) => void,
  rows?: { detach(group: string, index: number): void },
): () => void {
  let active = false
  const move = (ev: MouseEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < THRESHOLD) return
      active = true
      document.body.classList.add('pane-dragging')
    }
    ev.preventDefault()
    const { over, zone, row } = resolveTarget(ev, id, !!rows)
    const s = dragStore.getState()
    const sameRow = s.row === row || (s.row !== null && row !== null && s.row.group === row.group && s.row.slot === row.slot)
    if (s.from !== id || s.over !== over || s.zone !== zone || !sameRow) dragStore.setState({ from: id, over, zone, row })
  }
  const end = (commit: boolean) => {
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('mouseup', up, true)
    window.removeEventListener('keydown', key, true)
    const { over, zone, row } = dragStore.getState()
    if (active) {
      document.body.classList.remove('pane-dragging')
      dragStore.setState({ from: null, over: null, zone: null, row: null })
    }
    if (!commit || !active) return
    if (row && rows) rows.detach(row.group, row.slot)
    else if (over !== null && over !== id && zone !== null) drop(id, over, zone)
  }
  const up = (ev: MouseEvent) => {
    // The pane the pointer is released over, even when no move event reached it.
    if (active) dragStore.setState(resolveTarget(ev, id, !!rows))
    end(true)
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !active) return
    ev.preventDefault()
    ev.stopPropagation()
    end(false)
  }
  window.addEventListener('mousemove', move, true)
  window.addEventListener('mouseup', up, true)
  window.addEventListener('keydown', key, true)
  return () => end(false)
}

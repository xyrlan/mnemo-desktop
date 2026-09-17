import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PaneId, Rect, Side } from '../layout/tree'

/** Which region of a target rect a drop would land in. */
export type Zone = Side | 'center'

/** A pane bar being dragged: `from` once the pointer has moved past THRESHOLD, `over` the
 *  pane under it (null over a divider, the tab bar, or its own pane), and `zone` the region
 *  of `over` the pointer is in (null whenever `over` is null). */
export type DragState = { from: PaneId | null; over: PaneId | null; zone: Zone | null }

export const dragStore = createStore<DragState>(() => ({ from: null, over: null, zone: null }))
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

/** The pane (other than `id`) an event is over, and the zone within it, from the DOM. */
function resolveTarget(ev: MouseEvent, id: PaneId): { over: PaneId | null; zone: Zone | null } {
  const el = paneElement(ev.target)
  const rawId = el ? Number(el.dataset.pane) : NaN
  const under = Number.isFinite(rawId) ? rawId : null
  const over = under === id ? null : under
  if (over === null || !el) return { over, zone: null }
  const r = el.getBoundingClientRect()
  return { over, zone: dropZone(ev.clientX, ev.clientY, { x: r.left, y: r.top, w: r.width, h: r.height }) }
}

/** Follows the pointer from a mousedown on pane `id`'s bar until release, then calls `drop`
 *  with the pane and zone it was let go over — never for its own pane, nothing, or a cancel.
 *  Listens in the capture phase so xterm, which handles its own mouse events, cannot hide the
 *  moves. Escape cancels. Returns a cancel function. */
export function startPaneDrag(
  id: PaneId,
  start: { clientX: number; clientY: number },
  drop: (from: PaneId, to: PaneId, zone: Zone) => void,
): () => void {
  let active = false
  const move = (ev: MouseEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < THRESHOLD) return
      active = true
      document.body.classList.add('pane-dragging')
    }
    ev.preventDefault()
    const { over, zone } = resolveTarget(ev, id)
    const s = dragStore.getState()
    if (s.from !== id || s.over !== over || s.zone !== zone) dragStore.setState({ from: id, over, zone })
  }
  const end = (commit: boolean) => {
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('mouseup', up, true)
    window.removeEventListener('keydown', key, true)
    const { over, zone } = dragStore.getState()
    if (active) {
      document.body.classList.remove('pane-dragging')
      dragStore.setState({ from: null, over: null, zone: null })
    }
    if (commit && active && over !== null && over !== id && zone !== null) drop(id, over, zone)
  }
  const up = (ev: MouseEvent) => {
    // The pane the pointer is released over, even when no move event reached it.
    if (active) dragStore.setState(resolveTarget(ev, id))
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

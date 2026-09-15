import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PaneId } from '../layout/tree'

/** A pane bar being dragged: `from` once the pointer has moved past THRESHOLD, `over` the
 *  pane under it (null over a divider, the tab bar, or its own pane). */
export type DragState = { from: PaneId | null; over: PaneId | null }

export const dragStore = createStore<DragState>(() => ({ from: null, over: null }))
export const useDrag = <T,>(sel: (s: DragState) => T) => useStore(dragStore, sel)

/** Pixels the pointer travels before a press on the bar becomes a drag (a click only focuses). */
export const THRESHOLD = 4

/** The pane an event happened over, from its target. Native child webviews (browser panes)
 *  swallow pointer events, so over those only their bar counts. */
export function paneUnder(target: EventTarget | null): PaneId | null {
  const el = target instanceof Element ? target.closest<HTMLElement>('.pane[data-pane]') : null
  const id = el ? Number(el.dataset.pane) : NaN
  return Number.isFinite(id) ? id : null
}

/** Follows the pointer from a mousedown on pane `id`'s bar until release, then calls `swap`
 *  when it was let go over another pane. Listens in the capture phase so xterm, which handles
 *  its own mouse events, cannot hide the moves. Escape cancels. Returns a cancel function. */
export function startPaneDrag(id: PaneId, start: { clientX: number; clientY: number }, swap: (a: PaneId, b: PaneId) => void): () => void {
  let active = false
  const move = (ev: MouseEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < THRESHOLD) return
      active = true
      document.body.classList.add('pane-dragging')
    }
    ev.preventDefault()
    const under = paneUnder(ev.target)
    const over = under === id ? null : under
    if (dragStore.getState().from !== id || dragStore.getState().over !== over) dragStore.setState({ from: id, over })
  }
  const end = (commit: boolean) => {
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('mouseup', up, true)
    window.removeEventListener('keydown', key, true)
    const { over } = dragStore.getState()
    if (active) {
      document.body.classList.remove('pane-dragging')
      dragStore.setState({ from: null, over: null })
    }
    if (commit && active && over !== null && over !== id) swap(id, over)
  }
  const up = (ev: MouseEvent) => {
    // The pane the pointer is released over, even when no move event reached it.
    if (active) {
      const under = paneUnder(ev.target)
      dragStore.setState({ over: under === id ? null : under })
    }
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

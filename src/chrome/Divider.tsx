// adapted from stablyai/orca src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx (ResizeHandle)
import type { Path } from '../layout/tree'
import { boxStyle, ratioAt, resolve, type DividerBox } from './geometry'

/** A split never gives either side less than this share (Orca's clamp). */
export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
export const clampRatio = (r: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

/** A seam: a 6px grab strip drawing a 3px line (chrome.css), that resizes the split it cuts
 *  while dragged, through `onRatio`. Between a tab's panes, or between groups. The pointer is
 *  captured, so the drag keeps going over a terminal or past the window's edge. `root` is the
 *  element the split's box is laid out in. */
export default function Divider({ d, root, onRatio }: { d: DividerBox; root: React.RefObject<HTMLDivElement | null>; onRatio(path: Path, ratio: number): void }) {
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const pointer = e.pointerId
    const box = root.current!.getBoundingClientRect()
    const row = d.dir === 'row'
    const total = row ? box.width : box.height
    const split = { start: resolve(row ? d.split.x : d.split.y, total), size: resolve(row ? d.split.w : d.split.h, total) }
    try {
      el.setPointerCapture?.(pointer)
    } catch {
      // Best effort: a synthetic or already-released pointer cannot be captured.
    }
    el.classList.add('dragging', 'is-dragging')
    document.body.classList.add(row ? 'resizing-row' : 'resizing-col')
    const move = (ev: PointerEvent) => {
      const at = row ? ev.clientX - box.left : ev.clientY - box.top
      onRatio(d.path, clampRatio(ratioAt(split, at)))
    }
    const up = () => {
      el.classList.remove('dragging', 'is-dragging')
      document.body.classList.remove('resizing-row', 'resizing-col')
      try {
        if (el.hasPointerCapture?.(pointer)) el.releasePointerCapture(pointer)
      } catch {
        // Already dropped by the browser.
      }
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }
  return <div className={`divider ${d.dir} ${d.dir === 'row' ? 'is-vertical' : 'is-horizontal'}`} style={boxStyle(d.box)} onPointerDown={onDown} role="separator" aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'} />
}

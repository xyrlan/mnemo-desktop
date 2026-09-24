import { useRef } from 'react'
import type { Node, PaneId } from './tree'
import { store, useApp } from './app-store'
import { paneView } from '../panes/registry'
import PaneBar from '../chrome/PaneBar'
import { useDrag } from '../chrome/drag'
import { useFileDrop } from '../terminal/drop'
import { boxStyle, flatLayout, ratioAt, resolve, type Box, type DividerBox } from '../chrome/geometry'

function Leaf({ id, box }: { id: PaneId; box: Box }) {
  const pane = useApp((s) => s.panes[id])
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  // Highlighted as a drop target while a pane bar or a file from Finder is dragged over it.
  const paneTarget = useDrag((s) => s.from !== null && s.over === id)
  const fileTarget = useFileDrop((s) => s.over === id)
  const target = paneTarget || fileTarget
  const source = useDrag((s) => s.from === id)
  const View = paneView(pane?.view ?? 'terminal')
  // `pane-drop`: a pane bar, not a file, is over it — DropZoneOverlay draws where it would land.
  const cls = `pane${focused ? ' focused' : ''}${target ? ' drop-target' : ''}${paneTarget ? ' pane-drop' : ''}${source ? ' drag-source' : ''}`
  return (
    <div className={cls} data-pane={id} style={boxStyle(box)} onMouseDown={() => store.getState().focusPane(id)}>
      <PaneBar id={id} />
      <div className="pane-content">
        {View ? <View id={id} props={pane?.props ?? {}} /> : <div className="pane-message">unknown pane view: {pane?.view}</div>}
      </div>
    </div>
  )
}

/** A split never gives either side less than this share (Orca's clamp). */
export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
export const clampRatio = (r: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

// adapted from stablyai/orca src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx (ResizeHandle)
/** The seam between two panes: a 6px grab strip drawing a 3px line (chrome.css), that resizes the
 *  split it cuts while dragged. The pointer is captured, so the drag keeps going over a terminal
 *  or past the window's edge. */
function Divider({ d, root }: { d: DividerBox; root: React.RefObject<HTMLDivElement | null> }) {
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
      store.getState().setRatio(d.path, clampRatio(ratioAt(split, at)))
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

/** A tab's panes as absolutely placed siblings keyed by pane id, in a stable order, with the
 *  dividers between them. The tree decides only where each box goes, so reshaping it (a swap,
 *  a split elsewhere) moves panes without remounting their views: a terminal keeps its screen. */
export default function SplitView({ node }: { node: Node }) {
  const root = useRef<HTMLDivElement>(null)
  const { panes, dividers } = flatLayout(node)
  const ids = [...panes.keys()].sort((a, b) => a - b)
  return (
    // `is-split`: more than one pane, so the ones without focus dim (chrome.css).
    <div ref={root} className={`split-root${ids.length > 1 ? ' is-split' : ''}`}>
      {ids.map((id) => (
        <Leaf key={id} id={id} box={panes.get(id)!} />
      ))}
      {dividers.map((d) => (
        <Divider key={`${d.dir}:${d.path.join('')}`} d={d} root={root} />
      ))}
    </div>
  )
}

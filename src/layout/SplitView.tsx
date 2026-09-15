import { useRef } from 'react'
import type { Node, PaneId } from './tree'
import { store, useApp } from './app-store'
import { paneView } from '../panes/registry'
import PaneBar from '../chrome/PaneBar'
import { useDrag } from '../chrome/drag'
import { boxStyle, flatLayout, ratioAt, resolve, type Box, type DividerBox } from '../chrome/geometry'

function Leaf({ id, box }: { id: PaneId; box: Box }) {
  const pane = useApp((s) => s.panes[id])
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const target = useDrag((s) => s.from !== null && s.over === id)
  const source = useDrag((s) => s.from === id)
  const View = paneView(pane?.view ?? 'terminal')
  const cls = `pane${focused ? ' focused' : ''}${target ? ' drop-target' : ''}${source ? ' drag-source' : ''}`
  return (
    <div className={cls} data-pane={id} style={boxStyle(box)} onMouseDown={() => store.getState().focusPane(id)}>
      <PaneBar id={id} />
      <div className="pane-content">
        {View ? <View id={id} props={pane?.props ?? {}} /> : <div className="pane-message">unknown pane view: {pane?.view}</div>}
      </div>
    </div>
  )
}

function Divider({ d, root }: { d: DividerBox; root: React.RefObject<HTMLDivElement | null> }) {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = e.currentTarget
    const box = root.current!.getBoundingClientRect()
    const row = d.dir === 'row'
    const total = row ? box.width : box.height
    const split = { start: resolve(row ? d.split.x : d.split.y, total), size: resolve(row ? d.split.w : d.split.h, total) }
    el.classList.add('dragging')
    document.body.classList.add(row ? 'resizing-row' : 'resizing-col')
    const move = (ev: MouseEvent) => {
      const at = row ? ev.clientX - box.left : ev.clientY - box.top
      store.getState().setRatio(d.path, ratioAt(split, at))
    }
    const up = () => {
      el.classList.remove('dragging')
      document.body.classList.remove('resizing-row', 'resizing-col')
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  }
  return <div className={`divider ${d.dir}`} style={boxStyle(d.box)} onMouseDown={onDown} />
}

/** A tab's panes as absolutely placed siblings keyed by pane id, in a stable order, with the
 *  dividers between them. The tree decides only where each box goes, so reshaping it (a swap,
 *  a split elsewhere) moves panes without remounting their views: a terminal keeps its screen. */
export default function SplitView({ node }: { node: Node }) {
  const root = useRef<HTMLDivElement>(null)
  const { panes, dividers } = flatLayout(node)
  const ids = [...panes.keys()].sort((a, b) => a - b)
  return (
    <div ref={root} className="split-root">
      {ids.map((id) => (
        <Leaf key={id} id={id} box={panes.get(id)!} />
      ))}
      {dividers.map((d) => (
        <Divider key={`${d.dir}:${d.path.join('')}`} d={d} root={root} />
      ))}
    </div>
  )
}

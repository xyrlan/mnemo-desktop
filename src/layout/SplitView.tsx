import { useRef } from 'react'
import type { Node, Path } from './tree'
import { store, useApp } from './app-store'
import { paneView } from '../panes/registry'

function Leaf({ id }: { id: number }) {
  const pane = useApp((s) => s.panes[id])
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const View = paneView(pane?.view ?? 'terminal')
  if (!View) return <div className="pane pane-message">unknown pane view: {pane?.view}</div>
  return (
    <div className={`pane${focused ? ' focused' : ''}`} data-pane={id} onMouseDown={() => store.getState().focusPane(id)}>
      <View id={id} props={pane?.props ?? {}} />
    </div>
  )
}

export default function SplitView({ node, path = [] }: { node: Node; path?: Path }) {
  const ref = useRef<HTMLDivElement>(null)
  if (node.kind === 'leaf') return <Leaf id={node.pane} />

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const box = ref.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => {
      const ratio =
        node.dir === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      store.getState().setRatio(path, ratio)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const pct = `${node.ratio * 100}%`
  return (
    <div ref={ref} className={`split ${node.dir}`}>
      <div style={{ flex: `0 0 calc(${pct} - 2px)`, minWidth: 0, minHeight: 0 }}>
        <SplitView node={node.children[0]} path={[...path, 0]} />
      </div>
      <div className="divider" onMouseDown={onDown} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <SplitView node={node.children[1]} path={[...path, 1]} />
      </div>
    </div>
  )
}

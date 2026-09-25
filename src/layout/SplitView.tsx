import { memo, useRef } from 'react'
import type { Node, PaneId, Path } from './tree'
import { store, useApp } from './app-store'
import { paneView } from '../panes/registry'
import ErrorBoundary from '../panes/ErrorBoundary'
import PaneBar from '../chrome/PaneBar'
import { useDrag } from '../chrome/drag'
import { useFileDrop } from '../terminal/drop'
import Divider from '../chrome/Divider'
import { boxStyle, flatLayout, FULL, type Box, type DividerBox } from '../chrome/geometry'

export { MIN_RATIO, MAX_RATIO, clampRatio } from '../chrome/Divider'

type LeafProps = {
  id: PaneId
  /** The tab it is in. */
  tab: string
  /** Where it is, as CSS lengths (`boxStyle`); none while its tab is not on screen (it stays
   *  mounted, hidden). Strings, so an unchanged pane is not drawn again. */
  left?: string
  top?: string
  width?: string
  height?: string
  /** Its tab has other panes: without focus, it dims a little. */
  split: boolean
  /** Its tab is shown in a group you are not in. */
  dim: boolean
}

const Leaf = memo(function Leaf({ id, tab, left, top, width, height, split, dim }: LeafProps) {
  const pane = useApp((s) => s.panes[id])
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  // Highlighted as a drop target while a pane bar or a file from Finder is dragged over it.
  const paneTarget = useDrag((s) => s.from !== null && s.over === id)
  const fileTarget = useFileDrop((s) => s.over === id)
  const target = paneTarget || fileTarget
  const source = useDrag((s) => s.from === id)
  const View = paneView(pane?.view ?? 'terminal')
  // `pane-drop`: a pane bar, not a file, is over it — DropZoneOverlay draws where it would land.
  const cls = `pane${focused ? ' focused' : ''}${split ? ' in-split' : ''}${dim ? ' is-dim' : ''}${target ? ' drop-target' : ''}${paneTarget ? ' pane-drop' : ''}${source ? ' drag-source' : ''}`
  return (
    <div className={cls} data-pane={id} data-tab={tab} style={left !== undefined ? { left, top, width, height } : { display: 'none' }} onMouseDown={() => store.getState().focusPane(id)}>
      <ErrorBoundary label={`pane ${pane?.title || pane?.view || id}`}>
        <PaneBar id={id} />
        <div className="pane-content">
          {View ? <View id={id} props={pane?.props ?? {}} /> : <div className="pane-message">unknown pane view: {pane?.view}</div>}
        </div>
      </ErrorBoundary>
    </div>
  )
})

/** A tab to lay out: its split tree, and the box it fills (null: not on screen). `dim`: it is
 *  shown in a group you are not in. */
export type PlacedTab = { tab: { id: string; root: Node }; place: Box | null; dim?: boolean }

type Seam = DividerBox & { tab: string }

/** Every pane of `tabs` as one flat list of absolutely placed siblings keyed by pane id, in a
 *  stable order, with the dividers of the tabs on screen. A pane's box is its box in its tab's
 *  tree inside the box its tab fills, so nothing but boxes changes when a tab moves to another
 *  group, a group splits or collapses, a worktree is switched, or a pane leaves its tab for one of
 *  its own: no pane view is ever remounted by any of them, and a terminal keeps its screen.
 *  Pressing a divider of a tab that is not the active one makes it active first, since a resize
 *  applies to the active tab. */
export function PaneLayer({ tabs, className = '' }: { tabs: readonly PlacedTab[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const leaves: LeafProps[] = []
  const seams: Seam[] = []
  for (const { tab, place, dim = false } of tabs) {
    const { panes, dividers } = flatLayout(tab.root, place ?? FULL)
    for (const [id, box] of panes) leaves.push({ id, tab: tab.id, ...(place && boxStyle(box)), split: panes.size > 1, dim })
    if (place) for (const d of dividers) seams.push({ ...d, tab: tab.id })
  }
  leaves.sort((a, b) => a.id - b.id)
  const resize = (tab: string) => (path: Path, ratio: number) => {
    const s = store.getState()
    if (tab && s.activeTab !== tab) s.activateTab(tab)
    store.getState().setRatio(path, ratio)
  }
  return (
    <div ref={root} className={`split-root ${className}`.trim()}>
      {leaves.map((l) => (
        <Leaf key={l.id} {...l} />
      ))}
      {seams.map((d) => (
        <Divider key={`${d.tab}:${d.dir}:${d.path.join('')}`} d={d} root={root} onRatio={resize(d.tab)} />
      ))}
    </div>
  )
}

/** One tab's panes filling their box, with the dividers between them (see `PaneLayer`). */
export default function SplitView({ node, tab = '' }: { node: Node; tab?: string }) {
  return <PaneLayer tabs={[{ tab: { id: tab, root: node }, place: FULL }]} />
}

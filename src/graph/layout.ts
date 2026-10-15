import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

/** What a `card` node shows. `tone` colours the border, `pulse` animates it (BLOCKED). */
export type CardData = {
  label: string
  sub?: string
  badge?: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
  pulse?: boolean
  [key: string]: unknown
}
export type CardNode = Node<CardData, 'card'>

export type Rankdir = 'LR' | 'TB'
export type LayoutOptions = { rankdir?: Rankdir; width?: number; height?: number; gap?: number }

/** Positions every node with dagre (layered DAG layout). Nodes keep their data; only
 *  `position` (top-left, as React Flow wants it) is set. Pure: same input, same output. */
export function layoutDagre<N extends Node, E extends Edge>(nodes: N[], edges: E[], opts: LayoutOptions = {}): N[] {
  const { rankdir = 'LR', width = 180, height = 48, gap = 24 } = opts
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, nodesep: gap, ranksep: gap * 2 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.width ?? width, height: n.height ?? height })
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return nodes.map((n) => {
    const p = g.node(n.id)
    const w = n.width ?? width
    const h = n.height ?? height
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } }
  })
}

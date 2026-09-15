import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

export const CARD_W = 220
export const CARD_H = 52
const PAD = 14

/** `layoutDagre` (src/graph) with groups: a node whose `parentId` names a `group` node is laid
 *  out inside it as a dagre compound graph. The group gets the box around its members plus a
 *  margin, and member positions become relative to the group's top-left, as React Flow wants.
 *  Pure: same input, same output. */
export function layoutGrouped(nodes: Node[], edges: Edge[], gap = 28): Node[] {
  const g = new dagre.graphlib.Graph({ compound: true })
  g.setGraph({ rankdir: 'LR', nodesep: gap, ranksep: gap * 2 })
  g.setDefaultEdgeLabel(() => ({}))
  const groups = new Set(nodes.filter((n) => n.type === 'group' && nodes.some((m) => m.parentId === n.id)).map((n) => n.id))
  const cards = nodes.filter((n) => n.type !== 'group')
  for (const n of cards) g.setNode(n.id, { width: CARD_W, height: CARD_H })
  for (const id of groups) g.setNode(id, {})
  for (const n of cards) if (n.parentId && groups.has(n.parentId)) g.setParent(n.id, n.parentId)
  const ids = new Set(cards.map((n) => n.id))
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target)
  dagre.layout(g)

  const corner = new Map<string, { x: number; y: number }>()
  const out: Node[] = []
  for (const id of groups) {
    const p = g.node(id)
    const box = { x: p.x - p.width / 2 - PAD, y: p.y - p.height / 2 - PAD }
    corner.set(id, box)
    const n = nodes.find((x) => x.id === id)!
    out.push({ ...n, position: box, style: { ...n.style, width: p.width + 2 * PAD, height: p.height + 2 * PAD } })
  }
  for (const n of cards) {
    const p = g.node(n.id)
    const abs = { x: p.x - CARD_W / 2, y: p.y - CARD_H / 2 }
    const c = n.parentId ? corner.get(n.parentId) : undefined
    if (c) out.push({ ...n, position: { x: abs.x - c.x, y: abs.y - c.y } })
    else {
      const { parentId: _drop, ...rest } = n
      out.push({ ...rest, position: abs })
    }
  }
  return out
}

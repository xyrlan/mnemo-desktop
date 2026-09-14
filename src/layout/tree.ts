export type PaneId = number
export type Dir = 'row' | 'col'
export type Node =
  | { kind: 'leaf'; pane: PaneId }
  | { kind: 'split'; dir: Dir; ratio: number; children: [Node, Node] }
export type Path = (0 | 1)[]
export type Rect = { x: number; y: number; w: number; h: number }
export type Side = 'left' | 'right' | 'up' | 'down'

export const leaf = (pane: PaneId): Node => ({ kind: 'leaf', pane })

export function leaves(n: Node): PaneId[] {
  return n.kind === 'leaf' ? [n.pane] : [...leaves(n.children[0]), ...leaves(n.children[1])]
}

export function splitAt(n: Node, target: PaneId, fresh: PaneId, dir: Dir): Node {
  if (n.kind === 'leaf') {
    return n.pane === target ? { kind: 'split', dir, ratio: 0.5, children: [n, leaf(fresh)] } : n
  }
  return { ...n, children: [splitAt(n.children[0], target, fresh, dir), splitAt(n.children[1], target, fresh, dir)] }
}

/** Returns null when the tree becomes empty, the same object when the pane is absent. */
export function closeLeaf(n: Node, target: PaneId): Node | null {
  if (n.kind === 'leaf') return n.pane === target ? null : n
  const [a, b] = n.children
  const a2 = closeLeaf(a, target)
  if (a2 === null) return b
  const b2 = closeLeaf(b, target)
  if (b2 === null) return a
  if (a2 === a && b2 === b) return n
  return { ...n, children: [a2, b2] }
}

export function replaceRatio(n: Node, path: Path, ratio: number): Node {
  if (n.kind === 'leaf') return n
  if (path.length === 0) return { ...n, ratio: Math.min(0.9, Math.max(0.1, ratio)) }
  const [head, ...rest] = path
  const children: [Node, Node] = [n.children[0], n.children[1]]
  children[head] = replaceRatio(children[head], rest, ratio)
  return { ...n, children }
}

export function neighbour(from: PaneId, side: Side, rects: Map<PaneId, Rect>): PaneId | null {
  const me = rects.get(from)
  if (!me) return null
  const cx = me.x + me.w / 2
  const cy = me.y + me.h / 2
  let best: PaneId | null = null
  let bestD = Infinity
  for (const [id, r] of rects) {
    if (id === from) continue
    const ox = r.x + r.w / 2
    const oy = r.y + r.h / 2
    const ok =
      side === 'right' ? r.x >= me.x + me.w - 1 :
      side === 'left' ? r.x + r.w <= me.x + 1 :
      side === 'down' ? r.y >= me.y + me.h - 1 :
      r.y + r.h <= me.y + 1
    if (!ok) continue
    const d = (ox - cx) ** 2 + (oy - cy) ** 2
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

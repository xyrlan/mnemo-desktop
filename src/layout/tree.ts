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

/** Removes a leaf so it can be placed elsewhere: its parent split collapses into the surviving
 *  sibling, which takes the whole of the parent's space. Null when the last leaf is extracted,
 *  the same tree when the pane is absent. */
export function extract(n: Node, target: PaneId): Node | null {
  return closeLeaf(n, target)
}

/** Replaces the target leaf with an even split holding it and `pane`, with `pane` on `side` of it.
 *  The same tree when the target is absent or `pane` is already in the tree (extract it first). */
export function graft(n: Node, target: PaneId, pane: PaneId, side: Side): Node {
  const ids = leaves(n)
  if (!ids.includes(target) || ids.includes(pane)) return n
  const dir: Dir = side === 'left' || side === 'right' ? 'row' : 'col'
  const first = side === 'left' || side === 'up'
  const walk = (m: Node): Node => {
    if (m.kind === 'leaf') {
      if (m.pane !== target) return m
      return { kind: 'split', dir, ratio: 0.5, children: first ? [leaf(pane), m] : [m, leaf(pane)] }
    }
    const [a, b] = m.children
    const a2 = walk(a)
    const b2 = a2 === a ? walk(b) : b
    return a2 === a && b2 === b ? m : { ...m, children: [a2, b2] }
  }
  return walk(n)
}

/** Exchanges the places of two panes; ratios and shape stay. The same tree when either is absent or a === b. */
export function swapLeaves(n: Node, a: PaneId, b: PaneId): Node {
  if (a === b) return n
  const ids = leaves(n)
  if (!ids.includes(a) || !ids.includes(b)) return n
  const walk = (m: Node): Node => {
    if (m.kind === 'leaf') return m.pane === a ? leaf(b) : m.pane === b ? leaf(a) : m
    return { ...m, children: [walk(m.children[0]), walk(m.children[1])] }
  }
  return walk(n)
}

export function replaceRatio(n: Node, path: Path, ratio: number): Node {
  if (n.kind === 'leaf') return n
  if (path.length === 0) return { ...n, ratio: Math.min(0.9, Math.max(0.1, ratio)) }
  const [head, ...rest] = path
  const children: [Node, Node] = [n.children[0], n.children[1]]
  children[head] = replaceRatio(children[head], rest, ratio)
  return { ...n, children }
}

/** The box nearest `from` (centre to centre) among those wholly on `side` of it: a pane, or a
 *  group of tabs. Null when none is. */
export function neighbour<K>(from: K, side: Side, rects: Map<K, Rect>): K | null {
  const me = rects.get(from)
  if (!me) return null
  const cx = me.x + me.w / 2
  const cy = me.y + me.h / 2
  let best: K | null = null
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

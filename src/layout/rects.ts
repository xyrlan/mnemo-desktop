import type { Node, PaneId, Rect } from './tree'

/** On-screen rectangles of every rendered pane (hidden tabs report zero-sized ones). */
export function paneRects(root: ParentNode = document): Map<PaneId, Rect> {
  const m = new Map<PaneId, Rect>()
  root.querySelectorAll<HTMLElement>('.pane[data-pane]').forEach((el) => {
    const r = el.getBoundingClientRect()
    m.set(Number(el.dataset.pane), { x: r.left, y: r.top, w: r.width, h: r.height })
  })
  return m
}

/** The box every tab is laid out in: the union of the visible panes. Every tab fills the
 *  same workspace, so this holds even right after a split the DOM has not rendered yet.
 *  Null when nothing is on screen (no DOM, first boot). */
export function workspaceRect(rects: Map<PaneId, Rect> = typeof document === 'undefined' ? new Map() : paneRects()): Rect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects.values()) {
    if (r.w <= 0 || r.h <= 0) continue
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Lays a tree out in `box` the way SplitView does (dividers ignored). */
export function layoutRects(n: Node, box: Rect, out: Map<PaneId, Rect> = new Map()): Map<PaneId, Rect> {
  if (n.kind === 'leaf') {
    out.set(n.pane, box)
    return out
  }
  const [a, b] = n.children
  if (n.dir === 'row') {
    const w = box.w * n.ratio
    layoutRects(a, { ...box, w }, out)
    layoutRects(b, { ...box, x: box.x + w, w: box.w - w }, out)
  } else {
    const h = box.h * n.ratio
    layoutRects(a, { ...box, h }, out)
    layoutRects(b, { ...box, y: box.y + h, h: box.h - h }, out)
  }
  return out
}

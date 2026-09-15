import type { Dir, Node, PaneId, Path } from '../layout/tree'

/** A length as `f` of the tab's box plus `px` pixels: exact under any window size, so
 *  the layout is plain CSS `calc()` and needs no measuring. */
export type Len = { f: number; px: number }
export type Box = { x: Len; y: Len; w: Len; h: Len }
/** `split` is the box of the whole split the divider cuts, which a drag measures against. */
export type DividerBox = { path: Path; dir: Dir; box: Box; split: Box }

/** Width of the grab strip between two panes. */
export const GAP = 6

const add = (a: Len, b: Len): Len => ({ f: a.f + b.f, px: a.px + b.px })
const scale = (a: Len, k: number): Len => ({ f: a.f * k, px: a.px * k })
const px = (v: number): Len => ({ f: 0, px: v })

export const FULL: Box = { x: px(0), y: px(0), w: { f: 1, px: 0 }, h: { f: 1, px: 0 } }

/** Every pane's box and every divider's box, flat. SplitView renders panes as siblings keyed
 *  by id, so moving a pane in the tree (swap) moves its box, never remounts its view. */
export function flatLayout(n: Node, box: Box = FULL, path: Path = [], out = { panes: new Map<PaneId, Box>(), dividers: [] as DividerBox[] }) {
  if (n.kind === 'leaf') {
    out.panes.set(n.pane, box)
    return out
  }
  const [pos, size] = n.dir === 'row' ? (['x', 'w'] as const) : (['y', 'h'] as const)
  const cut = add(box[pos], scale(box[size], n.ratio))
  const end = add(box[pos], box[size])
  const a = { ...box, [size]: add(scale(box[size], n.ratio), px(-GAP / 2)) }
  const bStart = add(cut, px(GAP / 2))
  const b = { ...box, [pos]: bStart, [size]: add(end, scale(bStart, -1)) }
  out.dividers.push({ path, dir: n.dir, split: box, box: { ...box, [pos]: add(cut, px(-GAP / 2)), [size]: px(GAP) } })
  flatLayout(n.children[0], a, [...path, 0], out)
  flatLayout(n.children[1], b, [...path, 1], out)
  return out
}

function css(l: Len): string {
  const p = round(l.px)
  if (l.f === 0) return `${p}px`
  const pct = `${round(l.f * 100)}%`
  return p === 0 ? pct : `calc(${pct} ${p < 0 ? '-' : '+'} ${Math.abs(p)}px)`
}
const round = (v: number) => Math.round(v * 1e4) / 1e4

export function boxStyle(b: Box): { left: string; top: string; width: string; height: string } {
  return { left: css(b.x), top: css(b.y), width: css(b.w), height: css(b.h) }
}

/** A length in pixels inside a container `total` pixels long. */
export const resolve = (l: Len, total: number) => l.f * total + l.px

/** The split ratio a pointer at `at` (same axis, container-relative) asks for. The divider's
 *  centre sits at `split start + ratio * split size`, so inverting that is exact. */
export function ratioAt(split: { start: number; size: number }, at: number): number {
  return split.size > 0 ? (at - split.start) / split.size : 0.5
}

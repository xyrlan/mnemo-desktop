import { splitAt, closeLeaf, leaves, replaceRatio, neighbour, swapLeaves, extract, graft, type Node, type Rect, type Side } from './tree'
import { layoutRects } from './rects'

const L = (p: number): Node => ({ kind: 'leaf', pane: p })

test('splitAt replaces the leaf with a split holding old and new', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect(t).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, children: [L(1), L(2)] })
})

test('splitAt on a nested leaf', () => {
  const t = splitAt({ kind: 'split', dir: 'row', ratio: 0.5, children: [L(1), L(2)] }, 2, 3, 'col')
  expect(leaves(t)).toEqual([1, 2, 3])
  expect((t as any).children[1]).toEqual({ kind: 'split', dir: 'col', ratio: 0.5, children: [L(2), L(3)] })
})

test('closeLeaf promotes the sibling', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect(closeLeaf(t, 1)).toEqual(L(2))
  expect(closeLeaf(t, 2)).toEqual(L(1))
})

test('closeLeaf deep: sibling subtree is promoted intact', () => {
  const t = splitAt(splitAt(L(1), 1, 2, 'row'), 2, 3, 'col')
  const r = closeLeaf(t, 1)
  expect(r).toEqual({ kind: 'split', dir: 'col', ratio: 0.5, children: [L(2), L(3)] })
})

test('closeLeaf of the only leaf returns null', () => {
  expect(closeLeaf(L(1), 1)).toBeNull()
})

test('closeLeaf of unknown pane returns the same tree', () => {
  const t = L(1)
  expect(closeLeaf(t, 9)).toBe(t)
})

test('replaceRatio clamps to [0.1, 0.9] and follows a path', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect((replaceRatio(t, [], 0.01) as any).ratio).toBe(0.1)
  expect((replaceRatio(t, [], 0.99) as any).ratio).toBe(0.9)
  expect((replaceRatio(t, [], 0.3) as any).ratio).toBe(0.3)
  const deep = splitAt(t, 2, 3, 'col')
  expect((replaceRatio(deep, [1], 0.7) as any).children[1].ratio).toBe(0.7)
  expect((replaceRatio(deep, [1], 0.7) as any).ratio).toBe(0.5)
})

test('neighbour picks the nearest pane in a direction by rect', () => {
  const rects = new Map<number, Rect>([
    [1, { x: 0, y: 0, w: 100, h: 100 }],
    [2, { x: 100, y: 0, w: 100, h: 100 }],
    [3, { x: 0, y: 100, w: 200, h: 100 }],
  ])
  expect(neighbour(1, 'right', rects)).toBe(2)
  expect(neighbour(2, 'left', rects)).toBe(1)
  expect(neighbour(1, 'down', rects)).toBe(3)
  expect(neighbour(3, 'up', rects)).toBe(1)
  expect(neighbour(1, 'up', rects)).toBeNull()
  expect(neighbour(9, 'up', rects)).toBeNull()
})

test('swapLeaves exchanges two panes across subtrees and keeps shape and ratios', () => {
  const t = replaceRatio(splitAt(splitAt(L(1), 1, 2, 'row'), 2, 3, 'col'), [1], 0.7)
  const s = swapLeaves(t, 1, 3)
  expect(leaves(s)).toEqual([3, 2, 1])
  expect(s).toEqual({
    kind: 'split', dir: 'row', ratio: 0.5,
    children: [L(3), { kind: 'split', dir: 'col', ratio: 0.7, children: [L(2), L(1)] }],
  })
  expect(swapLeaves(s, 3, 1)).toEqual(t)
})

test('swapLeaves is a no-op for the same pane or an absent one', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect(swapLeaves(t, 1, 1)).toBe(t)
  expect(swapLeaves(t, 1, 9)).toBe(t)
})

const S = (dir: 'row' | 'col', a: Node, b: Node, ratio = 0.5): Node => ({ kind: 'split', dir, ratio, children: [a, b] })

test('extract from a nested split collapses the parent into the sibling and keeps the rest', () => {
  const t = S('row', L(1), S('col', L(2), S('row', L(3), L(4), 0.3), 0.7), 0.6)
  expect(extract(t, 2)).toEqual(S('row', L(1), S('row', L(3), L(4), 0.3), 0.6))
  expect(extract(t, 4)).toEqual(S('row', L(1), S('col', L(2), L(3), 0.7), 0.6))
  expect(extract(t, 1)).toEqual(S('col', L(2), S('row', L(3), L(4), 0.3), 0.7))
})

test('extract leaves untouched subtrees shared', () => {
  const right = S('col', L(2), L(3))
  const t = S('row', S('row', L(1), L(4)), right)
  expect((extract(t, 4) as any).children[1]).toBe(right)
})

test('extract the last leaf returns null', () => {
  expect(extract(L(1), 1)).toBeNull()
})

test('extract an absent pane returns the same tree', () => {
  const t = S('row', L(1), L(2))
  expect(extract(t, 9)).toBe(t)
})

test('graft onto a leaf inside a split replaces only that leaf', () => {
  const t = S('row', L(1), S('col', L(2), L(3), 0.7), 0.6)
  expect(graft(t, 3, 5, 'right')).toEqual(S('row', L(1), S('col', L(2), S('row', L(3), L(5)), 0.7), 0.6))
})

test('graft orders the panes by side at an even ratio', () => {
  const cases: [Side, Node][] = [
    ['left', S('row', L(5), L(1))],
    ['right', S('row', L(1), L(5))],
    ['up', S('col', L(5), L(1))],
    ['down', S('col', L(1), L(5))],
  ]
  for (const [side, want] of cases) expect(graft(L(1), 1, 5, side)).toEqual(want)
})

test('graft places the pane on the named side on screen', () => {
  const box: Rect = { x: 0, y: 0, w: 200, h: 200 }
  const t = S('row', L(1), L(2))
  const r = (side: Side) => layoutRects(graft(t, 2, 5, side), box)
  expect(r('left').get(5)!.x).toBeLessThan(r('left').get(2)!.x)
  expect(r('right').get(5)!.x).toBeGreaterThan(r('right').get(2)!.x)
  expect(r('up').get(5)!.y).toBeLessThan(r('up').get(2)!.y)
  expect(r('down').get(5)!.y).toBeGreaterThan(r('down').get(2)!.y)
  for (const side of ['left', 'right', 'up', 'down'] as Side[]) expect(r(side).get(1)).toEqual({ x: 0, y: 0, w: 100, h: 200 })
})

test('graft is a no-op for an absent target, the target itself, or a pane already in the tree', () => {
  const t = S('row', L(1), L(2))
  expect(graft(t, 9, 5, 'left')).toBe(t)
  expect(graft(t, 1, 1, 'left')).toBe(t)
  expect(graft(t, 1, 2, 'left')).toBe(t)
})

test('extract then graft moves a pane and preserves leaves()', () => {
  const t = S('row', L(1), S('col', L(2), S('row', L(3), L(4), 0.3), 0.7), 0.6)
  const before = [...leaves(t)].sort()
  for (const p of leaves(t)) {
    const rest = extract(t, p)!
    for (const target of leaves(rest)) {
      for (const side of ['left', 'right', 'up', 'down'] as Side[]) {
        const moved = graft(rest, target, p, side)
        expect([...leaves(moved)].sort()).toEqual(before)
        expect(extract(moved, p)).toEqual(rest)
      }
    }
  }
})

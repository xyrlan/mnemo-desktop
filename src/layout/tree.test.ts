import { splitAt, closeLeaf, leaves, replaceRatio, neighbour, swapLeaves, type Node, type Rect } from './tree'

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

import type { GroupNode } from '../layout/store'
import { below, boxStyle, GAP, resolve, type Box } from '../chrome/geometry'
import { cornerGroups, groupLayout, ROW_H } from './layout'

const g = (group: string): GroupNode => ({ kind: 'group', group })
const split = (dir: 'row' | 'col', ratio: number, a: GroupNode, b: GroupNode): GroupNode => ({ kind: 'split', dir, ratio, children: [a, b] })
const px = (b: Box, W: number, H: number) => ({ x: resolve(b.x, W), y: resolve(b.y, H), w: resolve(b.w, W), h: resolve(b.h, H) })

test('no groups, nothing to lay out', () => {
  expect(groupLayout(null)).toEqual({ groups: [], seams: [] })
})

test('one group fills the workbench and touches every edge', () => {
  const { groups, seams } = groupLayout(g('a'))
  expect(groups).toHaveLength(1)
  expect(boxStyle(groups[0].box)).toEqual({ left: '0px', top: '0px', width: '100%', height: '100%' })
  expect(groups[0].edges).toEqual({ top: true, left: true, right: true, bottom: true })
  expect(seams).toEqual([])
  // Its body is what is under its row.
  expect(boxStyle(below(groups[0].box, ROW_H))).toEqual({ left: '0px', top: '36px', width: '100%', height: 'calc(100% - 36px)' })
})

test('a split cuts at its ratio with a GAP-wide seam, whose path the seam resizes', () => {
  const { groups, seams } = groupLayout(split('row', 0.4, g('a'), g('b')))
  const [a, b] = groups.map((x) => px(x.box, 1000, 600))
  expect(a).toEqual({ x: 0, y: 0, w: 400 - GAP / 2, h: 600 })
  expect(b).toEqual({ x: 400 + GAP / 2, y: 0, w: 600 - GAP / 2, h: 600 })
  expect(seams).toHaveLength(1)
  expect(seams[0].path).toEqual([])
  expect(seams[0].dir).toBe('row')
  expect(px(seams[0].box, 1000, 600)).toEqual({ x: 400 - GAP / 2, y: 0, w: GAP, h: 600 })
})

test('each group knows the edges it touches, and the corners of the top band are found', () => {
  // a | (b / c): a is the whole left; b is top-right; c touches only the right and the bottom.
  const l = groupLayout(split('row', 0.5, g('a'), split('col', 0.5, g('b'), g('c'))))
  const edges = Object.fromEntries(l.groups.map((x) => [x.group, x.edges]))
  expect(edges.a).toEqual({ top: true, left: true, right: false, bottom: true })
  expect(edges.b).toEqual({ top: true, left: false, right: true, bottom: false })
  expect(edges.c).toEqual({ top: false, left: false, right: true, bottom: true })
  expect(cornerGroups(l)).toEqual({ topLeft: 'a', topRight: 'b' })
  expect(l.seams.map((s) => s.path)).toEqual([[], [1]])
  // One group is both corners; a column of two has both on top.
  expect(cornerGroups(groupLayout(g('a')))).toEqual({ topLeft: 'a', topRight: 'a' })
  expect(cornerGroups(groupLayout(split('col', 0.5, g('a'), g('b'))))).toEqual({ topLeft: 'a', topRight: 'a' })
})

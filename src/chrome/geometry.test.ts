import { splitAt, replaceRatio, type Node } from '../layout/tree'
import { layoutRects } from '../layout/rects'
import { boxStyle, flatLayout, GAP, ratioAt, resolve, type Box } from './geometry'

const L = (p: number): Node => ({ kind: 'leaf', pane: p })
const px = (b: Box, W: number, H: number) => ({ x: resolve(b.x, W), y: resolve(b.y, H), w: resolve(b.w, W), h: resolve(b.h, H) })

test('a single leaf fills the tab', () => {
  const { panes, dividers } = flatLayout(L(1))
  expect(boxStyle(panes.get(1)!)).toEqual({ left: '0px', top: '0px', width: '100%', height: '100%' })
  expect(dividers).toEqual([])
})

test('a row split leaves a GAP-wide divider centred on the ratio', () => {
  const { panes, dividers } = flatLayout(replaceRatio(splitAt(L(1), 1, 2, 'row'), [], 0.3))
  expect(px(panes.get(1)!, 1000, 500)).toEqual({ x: 0, y: 0, w: 300 - GAP / 2, h: 500 })
  expect(px(panes.get(2)!, 1000, 500)).toEqual({ x: 300 + GAP / 2, y: 0, w: 700 - GAP / 2, h: 500 })
  expect(dividers).toHaveLength(1)
  expect(px(dividers[0].box, 1000, 500)).toEqual({ x: 300 - GAP / 2, y: 0, w: GAP, h: 500 })
  expect(boxStyle(panes.get(2)!)).toEqual({ left: 'calc(30% + 3px)', top: '0px', width: 'calc(70% - 3px)', height: '100%' })
})

test('nested splits tile the box exactly: panes and dividers never overlap and cover it', () => {
  // 1 | (2 / (3 | 4))
  const t = splitAt(splitAt(splitAt(L(1), 1, 2, 'row'), 2, 3, 'col'), 3, 4, 'row')
  const W = 1200
  const H = 800
  const { panes, dividers } = flatLayout(replaceRatio(replaceRatio(t, [], 0.4), [1], 0.25))
  const boxes = [...panes.values(), ...dividers.map((d) => d.box)].map((b) => px(b, W, H))
  const area = boxes.reduce((s, b) => s + b.w * b.h, 0)
  expect(area).toBeCloseTo(W * H, 6)
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1)) {
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      expect(ox > 1e-6 && oy > 1e-6).toBe(false)
    }
  expect(dividers.map((d) => d.path)).toEqual([[], [1], [1, 1]])
})

test('pane centres agree with layoutRects, which placement and focus navigation use', () => {
  const t = replaceRatio(splitAt(splitAt(L(1), 1, 2, 'row'), 2, 3, 'col'), [1], 0.7)
  const rects = layoutRects(t, { x: 0, y: 0, w: 1000, h: 600 })
  for (const [id, b] of flatLayout(t).panes) {
    const r = px(b, 1000, 600)
    const want = rects.get(id)!
    expect(Math.abs(r.x + r.w / 2 - (want.x + want.w / 2))).toBeLessThanOrEqual(GAP / 2)
    expect(Math.abs(r.y + r.h / 2 - (want.y + want.h / 2))).toBeLessThanOrEqual(GAP / 2)
  }
})

test('dragging a divider to where it is keeps the ratio', () => {
  const t = replaceRatio(splitAt(splitAt(L(1), 1, 2, 'row'), 2, 3, 'col'), [1], 0.7)
  const d = flatLayout(t).dividers.find((x) => x.path.length === 1)!
  const split = { start: resolve(d.split.y, 600), size: resolve(d.split.h, 600) }
  const centre = resolve(d.box.y, 600) + GAP / 2
  expect(ratioAt(split, centre)).toBeCloseTo(0.7, 9)
})

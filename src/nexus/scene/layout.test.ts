import type { World } from '../types'
import { nexus, robot, robots, territory, world } from './fixtures'
import { layOut, RING_MAX, ringRobots, ROBOT, scales, type Rect, type SceneLayout } from './layout'

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5

/** Each nexus's ring as a box: every robot on it, and the core. */
const ringBox = (n: SceneLayout['territories'][number]['nexuses'][number], s: number): Rect => {
  const half = n.r + (ROBOT / 2) * s
  return { x: n.x - half, y: n.y - half, w: 2 * half, h: 2 * half }
}

/** Nothing drawn sits on anything else: territories apart, rings apart and clear of the archive,
 *  robots a sprite apart on their ring and inside their territory. */
function expectClean(l: SceneLayout) {
  const s = l.scale
  l.territories.forEach((t, i) => {
    for (const u of l.territories.slice(i + 1)) expect(overlap(t, u)).toBe(false)
    const archive = { x: t.archive.x - 48 * s, y: t.archive.y - 48 * s, w: 96 * s, h: 96 * s }
    expect(inside(archive, t)).toBe(true)
    const rings = t.nexuses.map((n) => ringBox(n, s))
    rings.forEach((r, j) => {
      expect(inside(r, t)).toBe(true)
      expect(overlap(r, archive)).toBe(false)
      for (const o of rings.slice(j + 1)) expect(overlap(r, o)).toBe(false)
    })
    for (const n of t.nexuses)
      n.robots.forEach((r, j) => {
        expect(inside(r, t)).toBe(true)
        // A sprite's width apart: diagonal neighbours' boxes may touch, the art's margins do not.
        for (const o of n.robots.slice(j + 1)) expect(Math.hypot(o.cx - r.cx, o.cy - r.cy)).toBeGreaterThanOrEqual(ROBOT * s)
      })
  })
}

const busy = (): World =>
  world([
    territory('mnemo-desktop', [nexus('p1', robots(6, 'a')), nexus('p2')], 140),
    territory('mnemo', [nexus('p3', robots(12, 'b')), nexus('p4', [robot('c0')])], 12),
  ])

test('robots stand on a ring round their nexus, the first at the top, evenly apart', () => {
  const l = layOut(world([territory('mnemo', [nexus('p1', robots(5))])]), { w: 1400, h: 860 }, 1)
  const n = l.territories[0].nexuses[0]
  expect(n.robots.map((r) => r.robot.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  for (const r of n.robots) expect(Math.hypot(r.cx - n.x, r.cy - n.y)).toBeCloseTo(n.r, 0)
  expect(n.robots[0].cx).toBe(n.x)
  expect(n.robots[0].cy).toBeLessThan(n.y)
  const gaps = n.robots.map((r, i) => {
    const next = n.robots[(i + 1) % n.robots.length]
    return Math.hypot(next.cx - r.cx, next.cy - r.cy)
  })
  for (const g of gaps) expect(g).toBeCloseTo(gaps[0], -0.5)
  // Clear of the core: the top robot's badge does not reach the core's label.
  expect(n.r).toBeGreaterThan((48 + 20 + 32) * l.scale + 18)
})

test('a ring holds 15 robots and counts the rest; an overflowing ring keeps the ones that need you', () => {
  const many = robots(20)
  many[17] = robot('late-ask', { halo: 'needs-you', badge: 'alert', pose: 'waiting' })
  many[19] = robot('last-ask', { halo: 'needs-you', badge: 'alert', pose: 'waiting' })
  const { shown, hidden } = ringRobots(many)
  expect(shown).toHaveLength(RING_MAX)
  expect(hidden).toBe(5)
  expect(shown.map((r) => r.id)).toContain('late-ask')
  expect(shown.map((r) => r.id)).toContain('last-ask')
  // World order is kept, so a robot keeps its place on the ring.
  expect(shown.map((r) => r.id)).toEqual(many.filter((r) => shown.includes(r)).map((r) => r.id))
  const l = layOut(world([territory('mnemo', [nexus('p1', many)])]), { w: 1400, h: 860 }, 1)
  expect(l.territories[0].nexuses[0].robots).toHaveLength(RING_MAX)
  expect(l.territories[0].nexuses[0].hidden).toBe(5)
  expect(ringRobots(robots(15))).toEqual({ shown: robots(15), hidden: 0 })
})

test('the scale is a whole number of device pixels, at most 2 css px', () => {
  expect(scales(1)).toEqual([2, 1])
  expect(scales(2)).toEqual([2, 1.5, 1, 0.5])
  expect(scales(1.5)).toEqual([2, 4 / 3, 2 / 3])
  expect(scales(0)).toEqual([2, 1])
  for (const dpr of [1, 1.5, 2]) {
    const l = layOut(busy(), { w: 1100, h: 760 }, dpr)
    expect(Number.isInteger(Math.round(l.scale * dpr * 1e9) / 1e9)).toBe(true)
    for (const t of l.territories) for (const n of t.nexuses) for (const r of n.robots) expect(Math.abs(r.x * dpr - Math.round(r.x * dpr))).toBeLessThan(1e-6)
  }
})

test('the largest scale that fits: a small fleet is drawn big, a crowded one smaller, and it all fits the drawer', () => {
  const small = layOut(world([territory('mnemo', [nexus('p1', robots(2))])]), { w: 1400, h: 860 }, 1)
  expect(small.scale).toBe(2)
  const crowded = layOut(busy(), { w: 1400, h: 860 }, 1)
  expect(crowded.scale).toBe(1)
  for (const l of [small, crowded]) {
    expect(l.width).toBeLessThanOrEqual(1400)
    expect(l.height).toBeLessThanOrEqual(860)
    expectClean(l)
  }
  // More room never draws it smaller.
  expect(layOut(busy(), { w: 2400, h: 1600 }, 1).scale).toBeGreaterThanOrEqual(crowded.scale)
  expect(layOut(busy(), { w: 2800, h: 1800 }, 1).scale).toBe(2)
})

test('the universal core sits in the middle: between two territories in a row, in the centre of a 3×3 grid', () => {
  const two = layOut(busy(), { w: 1400, h: 860 }, 1)
  const [a, b] = two.territories
  expect(a.x + a.w).toBeLessThanOrEqual(two.core.x)
  expect(two.core.x).toBeLessThanOrEqual(b.x)
  // Where a 2×2 grid has more room, it would leave a cell empty and the core in a corner: a full
  // row wins.
  const pair = world([territory('mnemo', [nexus('p1', robots(3))]), territory('mnemo-desktop', [nexus('p2', robots(3, 'q'))])])
  const tight = layOut(pair, { w: 1100, h: 1000 }, 1)
  expect(tight.territories.map((t) => t.y)).toEqual([4, 4])
  expect(tight.territories[0].x + tight.territories[0].w).toBeLessThanOrEqual(tight.core.x)
  expect(tight.core.x).toBeLessThanOrEqual(tight.territories[1].x)
  const eight = layOut(world(Array.from({ length: 8 }, (_, i) => territory(`repo${i}`, [nexus(`p${i}`, robots(2, `r${i}-`))]))), { w: 1500, h: 1300 }, 1)
  expect(eight.scale).toBe(1)
  expect(eight.height).toBeLessThanOrEqual(1300)
  expect(eight.core.x).toBeCloseTo(eight.width / 2, -1)
  expect(Math.abs(eight.core.y - eight.height / 2)).toBeLessThan(20)
  expectClean(eight)
})

test('with no live session the core stands alone in the middle', () => {
  const l = layOut(world([]), { w: 1000, h: 700 }, 1)
  expect(l.territories).toEqual([])
  expect(l.core.x).toBe(500)
  expect(Math.abs(l.core.y - 350)).toBeLessThan(20)
})

test('when even the smallest scale overflows, the scene grows past the drawer instead of overlapping', () => {
  const l = layOut(busy(), { w: 420, h: 300 }, 1)
  expect(l.scale).toBe(1)
  expect(l.width >= 420 || l.height > 300).toBe(true)
  expect(l.height).toBeGreaterThan(300)
  expectClean(l)
})

test('the same world in the same box is laid out the same', () => {
  expect(layOut(busy(), { w: 1300, h: 820 }, 2)).toEqual(layOut(busy(), { w: 1300, h: 820 }, 2))
})

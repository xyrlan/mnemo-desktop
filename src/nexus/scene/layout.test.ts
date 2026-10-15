import type { World } from '../types'
import { nexus, robot, robots, territory, typicalFleet, world } from './fixtures'
import { archiveLabel, labelWidth, layOut, RING_MAX, ringRadius, ringRobots, ROBOT, scales, type Rect, type SceneLayout } from './layout'

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5

/** What each thing draws, text included: a sprite with its label under it (as wide as the sprite or
 *  the label, which keeps its size), and over a robot its badge. */
const drawn = (cx: number, cy: number, size: number, label: number, over = 0): Rect => {
  const w = Math.max(size, label)
  return { x: cx - w / 2, y: cy - size / 2 - over, w, h: size + over + 18 }
}

/** Nothing drawn sits on anything else: territories apart; archive, nexuses and robots, their labels
 *  and badges, inside their territory and off each other; robots a sprite apart on their ring. */
function expectClean(l: SceneLayout) {
  const s = l.scale
  l.territories.forEach((t, i) => {
    for (const u of l.territories.slice(i + 1)) expect(overlap(t, u)).toBe(false)
    const boxes: Array<{ box: Rect; ring?: number }> = [{ box: drawn(t.archive.x, t.archive.y, 96 * s, labelWidth(archiveLabel(t.territory.archive))) }]
    t.nexuses.forEach((n, ni) => {
      boxes.push({ box: drawn(n.x, n.y, 96 * s, Math.min(labelWidth(n.nexus.label), 96 * s + 32)) })
      if (n.robots.length) expect(inside({ x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r }, t)).toBe(true)
      for (const r of n.robots) boxes.push({ box: drawn(r.cx, r.cy, ROBOT * s, Math.min(72, labelWidth(r.robot.label)), 20 * s), ring: ni })
      // A sprite's width apart: diagonal neighbours' boxes may touch, the art's margins do not.
      n.robots.forEach((r, j) => {
        for (const o of n.robots.slice(j + 1)) expect(Math.hypot(o.cx - r.cx, o.cy - r.cy)).toBeGreaterThanOrEqual(ROBOT * s)
      })
    })
    boxes.forEach((a, j) => {
      expect(inside(a.box, t)).toBe(true)
      for (const b of boxes.slice(j + 1)) if (a.ring === undefined || a.ring !== b.ring) expect(overlap(a.box, b.box)).toBe(false)
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

test('a typical fleet draws at 1× or more in a 1440×800 drawer, and fits it', () => {
  // dpr 1.5 has no 1×: its whole-device-pixel scales are 4/3 and 2/3.
  for (const dpr of [1, 2]) {
    const l = layOut(typicalFleet(), { w: 1440, h: 800 }, dpr)
    expect(l.scale).toBeGreaterThanOrEqual(1)
    expect(l.width).toBeLessThanOrEqual(1440)
    expect(l.height).toBeLessThanOrEqual(800)
    expectClean(l)
  }
  // The real fleet the issue measured had robots under one nexus of 11: that too.
  const idle = world(Array.from({ length: 7 }, (_, i) => territory(`t${i}`, Array.from({ length: i < 4 ? 2 : 1 }, (_, j) => nexus(`n${i}-${j}`, i === 0 && j === 0 ? robots(7) : [])))))
  const l = layOut(idle, { w: 1440, h: 800 }, 2)
  expect(l.scale).toBeGreaterThanOrEqual(1)
  expectClean(l)
})

test('a ring holds what it has: none without robots, and as before at 15', () => {
  const home = nexus('p1')
  expect(ringRadius([], 1, home)).toBe(0)
  // Fewer robots, a smaller ring (not strictly: a robot straight under the nexus must clear its label).
  for (const n of [1, 2, 3, 8]) expect(ringRadius(robots(n), 1, home)).toBeLessThan(ringRadius(robots(15), 1, home))
  // Fifteen robots side by side set the ring, as they did when every ring was sized for fifteen.
  expect(ringRadius(robots(15), 1, home)).toBe(Math.ceil((15 * 74) / (2 * Math.PI)))
  // Nexuses with no robots stand a sprite and a gap apart, not a ring apart.
  const l = layOut(world([territory('atlas', [nexus('p1'), nexus('p2'), nexus('p3')])]), { w: 1440, h: 800 }, 1)
  const [a, b] = l.territories[0].nexuses
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual((96 + 16) * l.scale)
  expect(l.territories[0].nexuses.every((n) => n.r === 0 && !n.robots.length)).toBe(true)
})

test("a territory's nexuses use its room rather than one column", () => {
  const l = layOut(typicalFleet(), { w: 1440, h: 800 }, 2)
  for (const t of l.territories.filter((t) => t.nexuses.length > 1)) {
    const items = [t.archive, ...t.nexuses]
    expect(new Set(items.map((p) => p.x)).size).toBeGreaterThan(1)
  }
})

test('the same world in the same box is laid out the same', () => {
  expect(layOut(busy(), { w: 1300, h: 820 }, 2)).toEqual(layOut(busy(), { w: 1300, h: 820 }, 2))
})

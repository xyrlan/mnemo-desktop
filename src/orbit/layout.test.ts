import { sampleActions, sampleWorld } from '../world/sample'
import type { Session, World } from '../world/types'
import { assignRays, cardPlace, chartOf, checkLabels, coreObstacle, firstNode, geom, labelBounds, labelItems, labelWidth, leaderOf, neighbour, shapeOf, solveLabels, stageOf, type LabelItem, type Stage } from './layout'
import { buildScene } from './model'

const world = sampleWorld()
const SIZES: [number, number, number][] = [
  [2560, 1386, 16],
  [1920, 1026, 14],
  [1366, 721, 12.5],
]
const TAU = Math.PI * 2
const titled = (w: World, text: string): Session => w.sessions.find((s) => s.title.startsWith(text))!

/** Labels of the size the sample's come out at: a two-line title, facts, a family line and
 *  two lines of what waits, at the widest a label may be. */
const sized = (stage: Stage) => new Map(stage.placed.map((p) => [p.id, { w: Math.round(labelWidth(stage.g) * (p.body.pend.length ? 1 : 0.85)), h: Math.round((p.body.pend.length ? 6.6 : 4.2) * stage.g.em) }]))
const solved = (stage: Stage, before?: Map<string, string>) => {
  const items = labelItems(stage, sized(stage))
  const chart = chartOf(stage.g, stage.sectors, 3, 0)
  const spots = solveLabels(items, [coreObstacle(stage.g), ...chart.obstacles], labelBounds(stage.g), stage.g.f, before)
  return { items, spots }
}

describe('the frame', () => {
  test('the orbits are ellipses that fill a wide window and stay inside it', () => {
    for (const [W, H, em] of SIZES) {
      const g = geom(W, H, em)
      expect(g.rx).toBeGreaterThan(g.ry * 1.5)
      expect(g.cx - g.rx).toBeGreaterThan(0)
      expect(g.cy - g.ry).toBeGreaterThan(0)
      expect(g.cy + g.ry).toBeLessThan(H)
      expect(g.k).toBeCloseTo(g.ry / g.rx)
    }
  })

  test('a tall window does not stretch the plane past a circle', () => {
    const g = geom(600, 1400, 14)
    expect(g.ry).toBeLessThanOrEqual(g.rx)
  })
})

describe('sectors and rays', () => {
  const g = geom(1920, 1026, 14)
  const scene = buildScene(world)
  const rays = assignRays(scene, g)

  test('every project has one sector and every body a ray inside its own project’s', () => {
    expect(rays.sectors.map((s) => s.name).sort()).toEqual(scene.projects.map((p) => p.name).sort())
    const inside = (th: number, a0: number, a1: number) => (((th - a0) % TAU) + TAU) % TAU <= (((a1 - a0) % TAU) + TAU) % TAU
    for (const p of scene.projects) {
      const sector = rays.sectors.find((s) => s.name === p.name)!
      for (const b of p.bodies) expect(inside(rays.theta.get(b.id)!, sector.a0, sector.a1)).toBe(true)
    }
    expect(new Set(rays.theta.values()).size).toBe(scene.bodies.length)
  })

  test('the first project takes the right side and the second the left', () => {
    const mid = (name: string) => rays.sectors.find((s) => s.name === name)!.mid
    expect(Math.cos(mid(scene.projects[0].name))).toBeGreaterThan(0.9)
    expect(Math.cos(mid(scene.projects[1].name))).toBeLessThan(-0.5)
  })

  test('a body moves only along its own ray: an answer changes its distance, not its direction', async () => {
    const box = { world: sampleWorld() }
    const act = sampleActions(() => box.world, (w) => (box.world = w))
    const before = stageOf(buildScene(box.world), g)
    const id = titled(box.world, 'Order status history').id
    await act.answer(box.world.pending.find((p) => p.session === id)!.id, 1)
    const after = stageOf(buildScene(box.world), g)
    for (const p of before.placed) expect(after.at.get(p.id)!.theta).toBe(p.theta)
    const was = before.at.get(id)!
    const is = after.at.get(id)!
    expect(Math.hypot(is.x - g.cx, is.y - g.cy)).toBeGreaterThan(Math.hypot(was.x - g.cx, was.y - g.cy))
  })

  test('a lone project is not divided from anything', () => {
    const one = buildScene({ ...world, sessions: world.sessions.filter((s) => s.project === 'tessera'), pending: [], projects: world.projects.filter((p) => p.name === 'tessera') })
    expect(assignRays(one, g).sectors.map((s) => s.whole)).toEqual([true])
    expect(chartOf(g, assignRays(one, g).sectors, 0, 0).sectors[0].divider).toBeNull()
    expect(assignRays(buildScene({ ...world, sessions: [], pending: [] }), g).sectors).toEqual([])
  })

  test('the beads of a project stand on the rim inside its sector', () => {
    const model = titled(world, 'Notes for the 2.5')
    const more = Array.from({ length: 16 }, (_, i): Session => ({ ...model, id: `ended-${i}`, short: `ended-${i}`, title: `Ended ${i}`, state: 'ended', live: false, children: [], lastAt: world.at - (i + 1) * 60_000 }))
    const stage = stageOf(buildScene({ ...world, sessions: [...world.sessions, ...more] }), g)
    expect(stage.beads.length).toBe(9 + 16 - 18)
    for (const b of stage.beads) {
      // on the rim: the ellipse's own equation
      expect(((b.x - g.cx) / g.rx) ** 2 + ((b.y - g.cy) / g.ry) ** 2).toBeCloseTo(1, 5)
      expect(stage.at.has(b.id)).toBe(false)
    }
  })
})

describe('a body’s shape', () => {
  const g = geom(1920, 1026, 14)
  const scene = buildScene(world)

  test('its footprint takes in its moons, the live ones inside the ended', () => {
    const lone = shapeOf(scene.bodyOf(titled(world, 'Dark theme contrast').id)!, g)
    const family = shapeOf(scene.bodyOf(titled(world, 'Idempotent retries').id)!, g)
    expect(lone.rings).toEqual([])
    expect(lone.fx).toBeCloseTo(lone.R + 3)
    expect(family.rings.length).toBe(1)
    expect(family.rings[0].moons.length).toBe(4)
    expect(family.fx).toBeGreaterThan(family.rings[0].r)
    // the plane is tilted, so the footprint is flatter than it is wide
    expect(family.fy).toBeLessThan(family.fx)
  })

  test('no ring carries more than fourteen moons', () => {
    const root = titled(world, 'Idempotent retries')
    const kid = titled(world, 'Tenant in every cache key')
    const kids = Array.from({ length: 31 }, (_, i): Session => ({ ...kid, id: `kid-${i}`, short: `kid-${i}`, state: i < 20 ? 'working' : 'ended' }))
    const many: World = { ...world, sessions: [...world.sessions.filter((s) => s.parent !== root.id).map((s) => (s.id === root.id ? { ...s, children: kids.map((k) => k.id) } : s)), ...kids], pending: [] }
    const shape = shapeOf(buildScene(many).bodyOf(root.id)!, g)
    expect(shape.rings.map((r) => r.moons.length)).toEqual([14, 6, 11])
    expect(shape.rings.map((r) => r.r)).toEqual([...shape.rings.map((r) => r.r)].sort((a, b) => a - b))
    expect(shape.rings[0].moons.every((m) => Number(m.id.slice(4)) < 20)).toBe(true)
  })
})

describe('the labels', () => {
  test.each(SIZES)('the sample’s labels all stand clear at %ix%i', (W, H, em) => {
    const stage = stageOf(buildScene(world), geom(W, H, em))
    const { items, spots } = solved(stage)
    expect(spots.size).toBe(stage.placed.length)
    expect(checkLabels(items, spots, labelBounds(stage.g))).toEqual({ overlap: 0, onBody: 0, clipped: 0 })
  })

  test('a label stands outward when there is room, and reads from its body', () => {
    const stage = stageOf(buildScene(world), geom(2560, 1386, 16))
    const { items, spots } = solved(stage)
    for (const it of items) {
      const spot = spots.get(it.id)!
      if (spot.side === 'E') expect(spot.align).toBe('l')
      if (spot.side === 'W') expect(spot.align).toBe('r')
    }
    const outward = items.filter((it) => (spots.get(it.id)!.side === 'E') === it.x >= stage.g.cx).length
    expect(outward).toBeGreaterThan(items.length / 2)
  })

  test('a label stays where it stood unless moving is clearly better', () => {
    const g = geom(1920, 1026, 14)
    const bounds = labelBounds(g)
    const it: LabelItem = { id: 'a', x: 900, y: 500, fx: 20, fy: 20, core: 15, w: 240, h: 60, prio: 1, pref: 'E' }
    const free = solveLabels([it], [], bounds, g.f).get('a')!
    expect(free.key).toBe('E0:0')
    // it stood half a label lower last time: it stays there, though level would be nearer
    const kept = solveLabels([it], [], bounds, g.f, new Map([['a', 'E0:0.5']])).get('a')!
    expect(kept.key).toBe('E0:0.5')
    expect(kept.y0).toBeGreaterThan(free.y0)
    // but not when something now stands there
    const moved = solveLabels([it], [{ ...kept, weight: 14 }], bounds, g.f, new Map([['a', 'E0:0.5']])).get('a')!
    expect(moved.key).not.toBe('E0:0.5')
    // and the sample's labels do not jump while its bodies creep along their rays
    const first = solved(stageOf(buildScene(world), g))
    const keys = new Map([...first.spots].map(([id, s]) => [id, s.key]))
    const later = solved(stageOf(buildScene({ ...world, at: world.at + 20 * 60_000 }), g), keys)
    expect(new Map([...later.spots].map(([id, s]) => [id, s.key]))).toEqual(keys)
  })

  test('the check counts what a reviewer would see on a picture', () => {
    const bounds = { x0: 0, y0: 0, x1: 1000, y1: 600 }
    const item = (id: string, x: number, y: number): LabelItem => ({ id, x, y, fx: 20, fy: 20, core: 15, w: 100, h: 40, prio: 0 })
    const items = [item('a', 100, 100), item('b', 400, 100), item('c', 700, 100)]
    const clean = new Map([
      ['a', { x0: 130, y0: 80, x1: 230, y1: 120 }],
      ['b', { x0: 430, y0: 80, x1: 530, y1: 120 }],
      ['c', { x0: 730, y0: 80, x1: 830, y1: 120 }],
    ])
    expect(checkLabels(items, clean, bounds)).toEqual({ overlap: 0, onBody: 0, clipped: 0 })
    const bad = new Map([
      ['a', { x0: 130, y0: 80, x1: 230, y1: 120 }],
      ['b', { x0: 200, y0: 90, x1: 300, y1: 130 }], // on a's label
      ['c', { x0: 950, y0: 80, x1: 1050, y1: 120 }], // out of the window
    ])
    expect(checkLabels(items, bad, bounds)).toEqual({ overlap: 1, onBody: 0, clipped: 1 })
    const onBody = new Map([...clean, ['c', { x0: 380, y0: 85, x1: 420, y1: 115 }]])
    expect(checkLabels(items, onBody, bounds).onBody).toBe(1)
  })

  test('a label never lies on another body, and does not stand nearer to one than to its own', () => {
    const g = geom(1920, 1026, 14)
    const bounds = labelBounds(g)
    // the neighbour stands where this label would go; it has no label of its own to push with
    const it: LabelItem = { id: 'a', x: 900, y: 500, fx: 20, fy: 20, core: 15, w: 240, h: 60, prio: 1, pref: 'E' }
    const near: LabelItem = { id: 'b', x: 1000, y: 500, fx: 20, fy: 20, core: 15, w: 0, h: 0, prio: 1, pref: 'E' }
    expect(solveLabels([it], [], bounds, g.f).get('a')!.side).toBe('E')
    const spots = solveLabels([it, near], [], bounds, g.f)
    expect(checkLabels([it, near], spots, bounds).onBody).toBe(0)
    const spot = spots.get('a')!
    const reach = (x: number, y: number) => Math.hypot(Math.max(spot.x0 - x, 0, x - spot.x1), Math.max(spot.y0 - y, 0, y - spot.y1))
    expect(reach(it.x, it.y)).toBeLessThan(reach(near.x, near.y))
  })

  test('two labels never share a place', () => {
    const g = geom(1920, 1026, 14)
    // two bodies facing each other, far enough apart that each one's best place is clear of
    // the other body and only the other's label is in the way
    const item = (id: string, x: number, pref: 'E' | 'W'): LabelItem => ({ id, x, y: 500, fx: 20, fy: 20, core: 15, w: 200, h: 60, prio: 1, pref })
    const items = [item('left', 900, 'E'), item('right', 1180, 'W')]
    const alone = items.map((it) => solveLabels([it], [], labelBounds(g), g.f).get(it.id)!)
    expect(alone.map((s) => s.key)).toEqual(['E0:0', 'W0:0'])
    expect(alone[0].x1).toBeGreaterThan(alone[1].x0)
    const spots = solveLabels(items, [], labelBounds(g), g.f)
    expect(checkLabels(items, spots, labelBounds(g))).toEqual({ overlap: 0, onBody: 0, clipped: 0 })
  })

  test('a label that had to stand off gets a line to its body; one beside it does not', () => {
    const it: LabelItem = { id: 'a', x: 100, y: 100, fx: 20, fy: 20, core: 15, w: 100, h: 40, prio: 0 }
    expect(leaderOf(it, { x0: 130, y0: 80, x1: 230, y1: 120 }, 1)).toBeNull()
    const far = leaderOf(it, { x0: 200, y0: 80, x1: 300, y1: 120 }, 1)!
    // a body with moons reaches further, so the same place is beside it
    expect(leaderOf({ ...it, fx: 90 }, { x0: 200, y0: 80, x1: 300, y1: 120 }, 1)).toBeNull()
    expect(far.angle).toBeCloseTo(0)
    expect(far.x).toBeCloseTo(119)
    expect(far.x + far.length).toBeLessThan(200)
  })
})

describe('the line art', () => {
  const g = geom(1920, 1026, 14)
  const stage = stageOf(buildScene(world), g)

  test('the inner band says when nothing needs him, and the outer how many are not named', () => {
    const names = (needs: number, more: number) => chartOf(g, stage.sectors, needs, more).bands.map((b) => b.name)
    expect(names(3, 0)).toEqual(['needs you', 'working', 'your turn', 'ended'])
    expect(names(0, 0)[0]).toBe('nothing needs you')
    expect(names(1, 7)[3]).toBe('ended · 7 more on the rim')
    expect(chartOf(g, stage.sectors, 3, 0).bands.map((b) => b.hot)).toEqual([true, false, false, false])
    expect(chartOf(g, stage.sectors, 0, 0).bands[0].hot).toBe(false)
  })

  test('the rim carries every project’s name, and the names are kept clear of labels', () => {
    const chart = chartOf(g, stage.sectors, 3, 0)
    expect(chart.sectors.map((s) => s.name).sort()).toEqual(['atlas-api', 'harbor-cli', 'lumen-web', 'tessera'])
    expect(chart.obstacles.length).toBeGreaterThan(4 * 4)
    for (const s of chart.sectors) expect(s.size).toBeGreaterThanOrEqual(8)
  })
})

describe('the cursor', () => {
  const g = geom(1920, 1026, 14)
  const stage = stageOf(buildScene(world), g)
  const nodes = [...stage.placed.map((p) => ({ id: p.id, x: p.x, y: p.y })), { id: 'core', x: g.cx, y: g.cy }]
  const core = nodes[nodes.length - 1]

  test('lands first on the body that asks loudest', () => {
    expect(firstNode(stage)).toBe(titled(world, 'Idempotent retries').id)
    expect(firstNode(stageOf(buildScene({ ...world, sessions: [], pending: [] }), g))).toBeNull()
  })

  test('an arrow reaches the nearest body that way, and the centre is one of them', () => {
    const right = neighbour(nodes, core, 1, 0)!
    expect(right.x).toBeGreaterThan(g.cx)
    for (const n of nodes) if (n.x > g.cx + 4 && Math.abs(n.y - g.cy) < (n.x - g.cx) * 0.5) expect(right.x).toBeLessThanOrEqual(n.x)
    // and back again
    expect(neighbour(nodes, right, -1, 0)?.id).toBe('core')
    expect(neighbour(nodes, core, 0, -1)!.y).toBeLessThan(g.cy)
    expect(neighbour(nodes, core, 0, 1)!.y).toBeGreaterThan(g.cy)
    expect(neighbour(nodes, core, -1, 0)!.x).toBeLessThan(g.cx)
  })

  test('nothing lies beyond the outermost body', () => {
    const rightmost = nodes.slice().sort((a, b) => b.x - a.x)[0]
    expect(neighbour(nodes, rightmost, 1, 0)).toBeNull()
    expect(neighbour([core], core, 1, 0)).toBeNull()
  })

  test('every body can be reached from the centre with the arrows', () => {
    const seen = new Set(['core'])
    const walk = [core]
    while (walk.length) {
      const from = walk.pop()!
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const to = neighbour(nodes, from, dx, dy)
        if (to && !seen.has(to.id)) {
          seen.add(to.id)
          walk.push(to)
        }
      }
    }
    expect(seen.size).toBe(nodes.length)
  })
})

describe('where a card opens', () => {
  const g = geom(1920, 1026, 14)
  const width = 28 * g.em

  test('beside its body, where the label stood, and inside the window', () => {
    const right = cardPlace(g, { x0: 1300, y0: 400, x1: 1560, y1: 480, align: 'l' }, width)
    expect(right.left).toBeCloseTo(1300 - 0.3 * g.em, 0)
    expect(right.top).toBe(400 - g.em)
    expect(right.bottom).toBeNull()
    const left = cardPlace(g, { x0: 300, y0: 400, x1: 560, y1: 480, align: 'r' }, width)
    expect(left.left + width).toBeCloseTo(560 + 0.3 * g.em, 0)
    const edge = cardPlace(g, { x0: 1800, y0: 400, x1: 1900, y1: 480, align: 'l' }, width)
    expect(edge.left + width).toBeLessThanOrEqual(g.W)
    expect(cardPlace(g, { x0: -50, y0: 400, x1: 100, y1: 480, align: 'r' }, width).left).toBeGreaterThanOrEqual(0)
  })

  test('a body near the foot of the window opens its card upward, and none is taller than the room it has', () => {
    const low = cardPlace(g, { x0: 1300, y0: 900, x1: 1560, y1: 980, align: 'l' }, width)
    expect(low.top).toBeNull()
    expect(low.bottom).toBeGreaterThan(0)
    expect(low.maxHeight).toBeLessThanOrEqual(g.H)
    expect(g.H - low.bottom! - low.maxHeight).toBeGreaterThanOrEqual(0)
    const high = cardPlace(g, { x0: 1300, y0: 5, x1: 1560, y1: 80, align: 'l' }, width)
    expect(high.top).toBeGreaterThanOrEqual(0)
    expect(high.top! + high.maxHeight).toBeLessThanOrEqual(g.H)
  })
})

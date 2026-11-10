// Orbit's geometry. Pure functions: the window's ellipse, where each project's sector and
// each body's ray fall, how large a body is drawn, where every label goes so that none
// collides or clips, and which body an arrow key reaches.

import { BAND, BANDS, type Body, type Scene } from './model'

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export interface Geom {
  W: number
  H: number
  /** The frame's root size in px: type and bodies scale with it, places with the window. */
  em: number
  /** `em / 16`: 1 on the maintainer's screen. */
  f: number
  cx: number
  cy: number
  rx: number
  ry: number
  /** The tilt: how much the plane is squashed (`ry / rx`). */
  k: number
  /** What the rim's names and the line of keys take above and below the ellipse. */
  top: number
  bottom: number
}

/** The scene's frame for a view of `W`×`H`. A circle on a wide window wastes half of it, so
 *  the orbits are ellipses that fill it and read as a tilted plane. */
export function geom(W: number, H: number, em = 16): Geom {
  const top = 2.9 * em
  const bottom = 4.5 * em
  const cy = top + (H - top - bottom) / 2
  let ry = Math.max(40, (H - top - bottom) / 2)
  let rx = Math.max(60, W / 2 - 4.1 * em)
  rx = Math.min(rx, ry * 2.05)
  ry = Math.min(ry, rx)
  return { W, H, em, f: em / 16, cx: W / 2, cy, rx, ry, k: ry / rx, top, bottom }
}

export const point = (g: Geom, rho: number, theta: number): { x: number; y: number } => ({ x: g.cx + g.rx * rho * Math.cos(theta), y: g.cy + g.ry * rho * Math.sin(theta) })

/** The widest a label may be, and the height one is given room for. */
export const labelWidth = (g: Geom): number => 21.25 * g.em
const LABEL_HEIGHT = 4

export interface Sector {
  name: string
  a0: number
  a1: number
  mid: number
  /** The only project: it has no neighbour to be divided from. */
  whole: boolean
}

export interface Rays {
  sectors: Sector[]
  /** Each body's direction, named and folded alike. */
  theta: Map<string, number>
}

/** Give every project a sector and every body a ray.
 *  A label needs less angle where the orbit runs vertically (the sides) than where it runs
 *  flat (top and bottom), so angle is handed out by that capacity: the first project takes
 *  the right side, the second the left, the rest alternate below and above. A body keeps
 *  its ray whatever its state; only its distance changes. */
export function assignRays(scene: Pick<Scene, 'projects'>, g: Geom): Rays {
  const w = labelWidth(g)
  const h = LABEL_HEIGHT * g.em
  const N = 720
  const cap: number[] = []
  let mean = 0
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) / N) * TAU
    const c = Math.max((g.rx * Math.abs(Math.sin(th))) / w, (g.ry * Math.abs(Math.cos(th))) / h)
    cap.push(c)
    mean += c / N
  }
  const cum = [0]
  for (let i = 0; i < N; i++) cum.push(cum[i] + 0.45 * mean + 0.55 * cap[i])
  const total = cum[N]
  const angleAt = (frac: number): number => {
    const target = (((frac % 1) + 1) % 1) * total
    let lo = 0
    let hi = N
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= target) lo = mid
      else hi = mid
    }
    return ((lo + (target - cum[lo]) / (cum[lo + 1] - cum[lo])) / N) * TAU
  }

  const ps = scene.projects
  const theta = new Map<string, number>()
  if (!ps.length) return { sectors: [], theta }
  const seq = [ps[0]]
  for (let i = 2; i < ps.length; i += 2) seq.push(ps[i])
  if (ps[1]) seq.push(ps[1])
  const above = []
  for (let i = 3; i < ps.length; i += 2) above.push(ps[i])
  seq.push(...above.reverse())

  // The beads of a project share half a body's room at the end of its sector.
  const room = (p: (typeof ps)[number]) => p.bodies.length + (p.folded.length ? 0.5 : 0)
  const n = seq.reduce((sum, p) => sum + room(p), 0)
  let at = -room(seq[0]) / 2 // the first project straddles the right side
  const sectors: Sector[] = []
  for (const p of seq) {
    const from = at
    p.bodies.forEach((b, i) => theta.set(b.id, angleAt((from + i + 0.5) / n)))
    p.folded.forEach((b, i) => theta.set(b.id, angleAt((from + p.bodies.length + (0.5 * (i + 0.5)) / p.folded.length) / n)))
    at += room(p)
    sectors.push({ name: p.name, a0: angleAt(from / n), a1: angleAt(at / n), mid: angleAt((from + at) / 2 / n), whole: seq.length === 1 })
  }
  return { sectors, theta }
}

export interface MoonRing {
  r: number
  /** The ids on this ring, with the angle each starts at, in degrees. */
  moons: { id: string; angle: number; period: number }[]
}

export interface BodyShape {
  /** The glyph's radius, the context ring's, and the footprint's half sizes. */
  r: number
  R: number
  fx: number
  fy: number
  rings: MoonRing[]
  /** What a moon is drawn at: the frame's size over the maintainer's. */
  scale: number
}

/** How a body is drawn: its size is what its tree spent, its moons stand on rings round it
 *  (at most fourteen on one), the live ones inside the ended ones. */
export function shapeOf(b: Body, g: Geom): BodyShape {
  const us = g.f
  const r = (6 + 19 * b.size) * us
  const R = r + 5.5 * us
  const rings: MoonRing[] = []
  let at = R + 16 * us
  const seed = (b.root.short.charCodeAt(0) % 9) * 11
  for (const group of [b.kids.filter((s) => s.state !== 'ended'), b.kids.filter((s) => s.state === 'ended')]) {
    for (let i = 0; i < group.length; i += 14) {
      const list = group.slice(i, i + 14)
      const ri = rings.length
      rings.push({ r: at, moons: list.map((s, j) => ({ id: s.id, angle: Math.round((360 * j) / list.length + ri * 37 + seed), period: 22 + ((j * 7 + ri * 5) % 16) })) })
      at += 13 * us
    }
  }
  const reach = rings.length ? rings[rings.length - 1].r + 5 * us : 0
  return { r, R, rings, scale: us, fx: Math.max(R + 3, reach), fy: reach ? Math.max(R + 3, reach * g.k + 4) : R + 3 }
}

export interface Placed {
  id: string
  body: Body
  x: number
  y: number
  theta: number
  shape: BodyShape
}

export interface Stage {
  g: Geom
  sectors: Sector[]
  /** The named bodies, where they stand. */
  placed: Placed[]
  /** The beads on the rim. */
  beads: { id: string; body: Body; x: number; y: number }[]
  at: Map<string, Placed>
}

/** Everything about the scene that needs no measuring: where each body stands. */
export function stageOf(scene: Scene, g: Geom): Stage {
  const rays = assignRays(scene, g)
  const placed = scene.bodies.map((body) => {
    const theta = rays.theta.get(body.id) ?? 0
    return { id: body.id, body, theta, ...point(g, body.rho, theta), shape: shapeOf(body, g) }
  })
  const beads = scene.folded.map((body) => ({ id: body.id, body, ...point(g, 1, rays.theta.get(body.id) ?? 0) }))
  return { g, sectors: rays.sectors, placed, beads, at: new Map(placed.map((p) => [p.id, p])) }
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Obstacle extends Rect {
  weight: number
}

export interface Chart {
  /** An SVG path of the rim's ticks, as on an instrument. */
  ticks: string
  bands: { id: string; rx: number; ry: number; name: string; arc: string; size: number; hot: boolean }[]
  sectors: { name: string; divider: string | null; arc: string; size: number }[]
  /** What a label keeps off: the band names (softly) and the rim's names. */
  obstacles: Obstacle[]
}

/** The static line art: bands, the rim, the dividers where two projects meet, and the names
 *  on arcs. `needs` is how many families stand in "needs you"; `settled` that nothing waits. */
export function chartOf(g: Geom, sectors: Sector[], needs: number, more: number): Chart {
  const n = (v: number) => v.toFixed(1)
  const P = (rho: number, th: number) => {
    const p = point(g, rho, th)
    return `${n(p.x)} ${n(p.y)}`
  }
  let ticks = ''
  for (let i = 0; i < 180; i++) {
    const th = (i / 180) * TAU
    ticks += `M${P(1, th)}L${P(i % 5 ? 1.006 : 1.014, th)}`
  }
  const obstacles: Obstacle[] = []

  const nameSize = 0.66 * g.em
  const bands = BANDS.map((b) => {
    const rho = b.hi - (0.4 * g.em + nameSize) / g.ry
    const d = 0.5
    const name = b.id === 'need' && !needs ? 'nothing needs you' : b.id === 'ended' && more ? `ended · ${more} more on the rim` : b.name
    const w = name.length * nameSize * 0.95
    obstacles.push({ x0: g.cx - w / 2, x1: g.cx + w / 2, y0: g.cy - g.ry * rho - nameSize * 1.3, y1: g.cy - g.ry * rho + 4, weight: 0.6 })
    return {
      id: b.id,
      rx: g.rx * b.lo,
      ry: g.ry * b.lo,
      name,
      arc: `M${P(rho, -Math.PI / 2 - d)}A${n(g.rx * rho)} ${n(g.ry * rho)} 0 0 1 ${P(rho, -Math.PI / 2 + d)}`,
      size: nameSize,
      hot: b.id === 'need' && needs > 0,
    }
  })

  const size = 0.94 * g.em
  const out = sectors.map((s) => {
    const flip = Math.sin(s.mid) > 0.5
    // the same clearance in pixels all the way round, whatever the ellipse does to a radius
    const along = Math.hypot(g.rx * Math.cos(s.mid), g.ry * Math.sin(s.mid))
    const rho = 1 + (0.62 * g.em + (flip ? size * 0.74 : 0)) / along
    const span = s.whole ? 1.2 : Math.max(0.12, Math.min(1.3, ((((s.a1 - s.a0) % TAU) + TAU) % TAU) / 2))
    const a = s.mid - span
    const b = s.mid + span
    const sweep = `A${n(g.rx * rho)} ${n(g.ry * rho)} 0 0 `
    const arc = flip ? `M${P(rho, b)}${sweep}0 ${P(rho, a)}` : `M${P(rho, a)}${sweep}1 ${P(rho, b)}`
    // shrink a name that is longer than its arc
    const pa = point(g, rho, a)
    const pm = point(g, rho, s.mid)
    const pb = point(g, rho, b)
    const len = Math.hypot(pm.x - pa.x, pm.y - pa.y) + Math.hypot(pb.x - pm.x, pb.y - pm.y)
    const fz = Math.max(8, Math.min(size, (len * 0.92) / (s.name.length * 1.02)))
    // the name is an obstacle for labels: a run of small boxes along its arc
    const half = (s.name.length * fz * 1.06) / 2
    const per = Math.hypot(g.rx * Math.sin(s.mid), g.ry * Math.cos(s.mid))
    const mid = 1 + (0.62 * g.em + fz * 0.5) / along
    for (let t = -1; t <= 1.001; t += 0.125) {
      const q = point(g, mid, s.mid + (t * half) / per)
      obstacles.push({ x0: q.x - fz * 1.2, x1: q.x + fz * 1.2, y0: q.y - fz * 1.2, y1: q.y + fz * 1.2, weight: 14 })
    }
    return { name: s.name, divider: s.whole ? null : `M${P(BANDS[0].lo, s.a0)}L${P(1.014, s.a0)}`, arc, size: fz }
  })
  return { ticks, bands, sectors: out, obstacles }
}

/* ---------- labels ---------- */

export const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

export interface LabelItem {
  id: string
  /** The body's centre, its footprint's half sizes, and the radius of the body itself. */
  x: number
  y: number
  fx: number
  fy: number
  core: number
  /** The label's own size. */
  w: number
  h: number
  /** The band, innermost first: who is placed first. */
  prio: number
  /** The side it should stand on when it can. */
  pref?: 'E' | 'W'
}

export interface Spot extends Rect {
  /** How the text lines up: against the body. */
  align: 'l' | 'r' | 'c'
  side: 'E' | 'W' | 'N' | 'S'
  shift: number
  /** Which of its body's places this is: the same key, the same place beside the body. */
  key: string
}

function candidates(it: LabelItem, gaps: number[]): Spot[] {
  const out: Spot[] = []
  const { x, y, fx, fy, w, h } = it
  const push = (x0: number, y0: number, align: Spot['align'], side: Spot['side'], shift: number, key: string) => out.push({ x0, y0, x1: x0 + w, y1: y0 + h, align, side, shift, key })
  gaps.forEach((gap, gi) => {
    for (const sh of [0, -0.5, 0.5, -1, 1, -1.6, 1.6, -2.3, 2.3]) {
      push(x + fx + gap, y - h / 2 + sh * h, 'l', 'E', Math.abs(sh), `E${gi}:${sh}`)
      push(x - fx - gap - w, y - h / 2 + sh * h, 'r', 'W', Math.abs(sh), `W${gi}:${sh}`)
    }
    for (const sh of [0, -0.3, 0.3, -0.5, 0.5]) {
      push(x - w / 2 + sh * w, y - fy - gap - h, sh < 0 ? 'r' : sh > 0 ? 'l' : 'c', 'N', Math.abs(sh) * 2, `N${gi}:${sh}`)
      push(x - w / 2 + sh * w, y + fy + gap, sh < 0 ? 'r' : sh > 0 ? 'l' : 'c', 'S', Math.abs(sh) * 2, `S${gi}:${sh}`)
    }
  })
  return out
}

/** Place one label per item. Each has about 140 places round its body; a cost keeps it off
 *  other labels, off other bodies, off `fixed`, inside `bounds`, beside its own body and
 *  nearer to it than to any other. A greedy pass depends on who goes first, so twelve orders
 *  are tried and the cheapest whole layout is kept. `before` is where each label stood last
 *  time: a label stays where it was unless moving is clearly better, so a body creeping
 *  along its ray does not make its name jump. */
export function solveLabels(items: LabelItem[], fixed: Obstacle[], bounds: Rect, f: number, before?: Map<string, string>): Map<string, Spot> {
  const gaps = [12, 24, 46, 80, 124].map((v) => v * f)
  const foot = items.map((it) => ({ x: it.x, y: it.y, x0: it.x - it.fx, y0: it.y - it.fy, x1: it.x + it.fx, y1: it.y + it.fy }))
  const reach = (c: Rect, x: number, y: number) => Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.y0 - y, 0, y - c.y1))
  // What a place costs whatever the other labels do: worked out once, cheapest first.
  const alone = (it: LabelItem, i: number, c: Spot): number => {
    let k = 0
    const out = Math.max(0, bounds.x0 - c.x0) + Math.max(0, c.x1 - bounds.x1) + Math.max(0, bounds.y0 - c.y0) + Math.max(0, c.y1 - bounds.y1)
    if (out > 0) k += 1e5 + out * 100
    const own = reach(c, it.x, it.y)
    for (let j = 0; j < foot.length; j++) {
      if (j === i) continue
      const o = foot[j]
      const a = overlap(c, o)
      if (a > 0) k += 3000 + a * 3
      // a label nearer to another body than to its own would be read as that body's
      else if (reach(c, o.x, o.y) < own + 8) k += 1500
    }
    for (const o of fixed) {
      const a = overlap(c, o)
      if (a > 0) k += o.weight * (600 + a)
    }
    k += own * 1.4 + c.shift * 6
    // beside the body reads as its label; above or below is the last resort
    k += c.side === it.pref ? 0 : c.side === 'E' || c.side === 'W' ? 26 : 70
    if (before?.get(it.id) === c.key) k -= 60
    return k
  }
  const cands = items.map((it, i) =>
    candidates(it, gaps)
      .map((spot) => ({ spot, cost: alone(it, i, spot) }))
      .sort((a, b) => a.cost - b.cost),
  )
  let placed: (Spot | null)[] = []
  const choose = (i: number): number => {
    let best: Spot | null = null
    let bk = Infinity
    for (const { spot, cost } of cands[i]) {
      // the places are in order of what they cost alone, and other labels only add to it
      if (cost >= bk) break
      let k = cost
      for (let j = 0; j < placed.length && k < bk; j++) {
        const other = placed[j]
        if (j === i || !other) continue
        const a = overlap(spot, other)
        if (a > 0) k += 4000 + a * 3
      }
      if (k < bk) {
        bk = k
        best = spot
      }
    }
    placed[i] = best
    return bk
  }
  // the bands' order, the window's edges inward, the four sweeps across it, a few fixed shuffles
  const mx = (bounds.x0 + bounds.x1) / 2
  const orders: ((a: number, b: number) => number)[] = [
    (a, b) => items[a].prio - items[b].prio || Math.abs(items[b].x - mx) - Math.abs(items[a].x - mx),
    (a, b) => Math.abs(items[b].x - mx) - Math.abs(items[a].x - mx),
    (a, b) => Math.abs(items[a].x - mx) - Math.abs(items[b].x - mx),
    (a, b) => items[a].y - items[b].y,
    (a, b) => items[b].y - items[a].y,
    (a, b) => items[a].x - items[b].x,
    (a, b) => items[b].x - items[a].x,
  ]
  for (let seed = 1; seed <= 5; seed++) {
    const key = items.map((_, i) => (Math.sin((i + 1) * 12.9898 * seed) * 43758.5453) % 1)
    orders.push((a, b) => key[a] - key[b])
  }
  let best: (Spot | null)[] = []
  let bestCost = Infinity
  for (const by of orders) {
    placed = items.map(() => null)
    const order = items.map((_, i) => i).sort(by)
    for (const i of order) choose(i)
    let total = 0
    for (let sweep = 0; sweep < 5; sweep++) {
      total = 0
      for (const i of order) total += choose(i)
    }
    if (total < bestCost) {
      bestCost = total
      best = placed
    }
  }
  const out = new Map<string, Spot>()
  items.forEach((it, i) => best[i] && out.set(it.id, best[i]))
  return out
}

/** What a reviewer would measure on a screenshot, counted: labels that overlap a label, sit
 *  on another body, or leave the window. */
export function checkLabels(items: LabelItem[], placed: Map<string, Rect>, bounds: Rect): { overlap: number; onBody: number; clipped: number } {
  const bad = { overlap: 0, onBody: 0, clipped: 0 }
  const ids = [...placed.keys()]
  ids.forEach((id, i) => {
    const a = placed.get(id)!
    if (a.x0 < bounds.x0 - 0.5 || a.y0 < bounds.y0 - 0.5 || a.x1 > bounds.x1 + 0.5 || a.y1 > bounds.y1 + 0.5) bad.clipped++
    for (let j = i + 1; j < ids.length; j++) if (overlap(a, placed.get(ids[j])!) > 1) bad.overlap++
    for (const it of items) {
      if (it.id === id) continue
      if (overlap(a, { x0: it.x - it.core, y0: it.y - it.core, x1: it.x + it.core, y1: it.y + it.core }) > 1) bad.onBody++
    }
  })
  return bad
}

/** Where labels may stand, and what they keep off besides each other. */
export function labelBounds(g: Geom): Rect {
  return { x0: 0.6 * g.em, y0: 0.5 * g.em, x1: g.W - 0.6 * g.em, y1: g.H - 2.3 * g.em }
}

/** The radius the centre piece is drawn in. */
export const coreRadius = (g: Geom): number => g.ry * 0.205

export function coreObstacle(g: Geom): Obstacle {
  const r = coreRadius(g) + 6
  return { x0: g.cx - r, x1: g.cx + r, y0: g.cy - r, y1: g.cy + r + 1.4 * g.em, weight: 6 }
}

/** The items the solver places, from where the bodies stand and how large each label came
 *  out. A label stands outward when there is room for it, inward at the window's edge. */
export function labelItems(stage: Stage, sizes: Map<string, { w: number; h: number }>): LabelItem[] {
  const { g } = stage
  const bounds = labelBounds(g)
  return stage.placed.map((p) => {
    const size = sizes.get(p.id) ?? { w: 0, h: 0 }
    const out = p.x >= g.cx ? 'E' : 'W'
    const room = out === 'E' ? p.x + p.shape.fx + 8 + size.w <= bounds.x1 : p.x - p.shape.fx - 8 - size.w >= bounds.x0
    return { id: p.id, x: p.x, y: p.y, fx: p.shape.fx, fy: p.shape.fy, core: p.shape.R, w: size.w, h: size.h, prio: BAND[p.body.band].i, pref: room ? out : out === 'E' ? 'W' : 'E' }
  })
}

/** The line from a body to a label that had to stand off from it, or null when it is close. */
export function leaderOf(it: LabelItem, spot: Rect, f: number): { x: number; y: number; length: number; angle: number } | null {
  const nx = clamp(it.x, spot.x0, spot.x1)
  const ny = clamp(it.y, spot.y0, spot.y1)
  const d = Math.hypot(nx - it.x, ny - it.y)
  if (d <= Math.max(it.fx, it.fy) + 18 * f) return null
  const angle = Math.atan2(ny - it.y, nx - it.x)
  const from = it.core + 4
  return { x: it.x + Math.cos(angle) * from, y: it.y + Math.sin(angle) * from, length: d - from - 3, angle }
}

/* ---------- the cursor ---------- */

export interface Node {
  id: string
  x: number
  y: number
}

/** The neighbour an arrow reaches from `from`: the nearest node along the arrow that is not
 *  far off to its side. Null when nothing lies that way. */
export function neighbour(nodes: Node[], from: Node, dx: number, dy: number): Node | null {
  let best: Node | null = null
  let bk = Infinity
  for (const n of nodes) {
    if (n.id === from.id) continue
    const along = (n.x - from.x) * dx + (n.y - from.y) * dy
    const across = Math.abs((n.x - from.x) * dy) + Math.abs((n.y - from.y) * dx)
    if (along <= 4 || across > along * 2.2) continue
    const k = along + across * 1.8
    if (k < bk) {
      bk = k
      best = n
    }
  }
  return best
}

/** Where the cursor lands when there is none yet: the body that asks loudest. */
export function firstNode(stage: Stage): string | null {
  const first = stage.placed.slice().sort((a, b) => BAND[a.body.band].i - BAND[b.body.band].i || a.body.rho - b.body.rho)[0]
  return first ? first.id : null
}

/** How tall a card is taken to be, in em, when deciding which way it opens. */
const CARD_HEIGHT = 24

/** Where a waiting item's card opens: where its body's label stands, so the body stays in
 *  sight beside it, growing away from the nearer edge and never past the window. */
export function cardPlace(g: Geom, spot: Rect & { align: 'l' | 'r' | 'c' }, width: number): { left: number; top: number | null; bottom: number | null; maxHeight: number } {
  const pad = g.em
  const beside = 0.3 * g.em
  const x = spot.align === 'r' ? spot.x1 - width + beside : spot.align === 'c' ? (spot.x0 + spot.x1 - width) / 2 : spot.x0 - beside
  const left = Math.round(clamp(x, 0.75 * g.em, g.W - width - 0.75 * g.em))
  const floor = g.H - 2.6 * g.em
  const roof = 0.5 * g.em
  // Down from the label's top while a card of an ordinary height fits under it; a body near
  // the foot of the window opens its card upward instead.
  if (spot.y0 - pad + CARD_HEIGHT * g.em <= floor) {
    const top = Math.round(Math.max(roof, spot.y0 - pad))
    return { left, top, bottom: null, maxHeight: Math.floor(floor - top) }
  }
  const end = Math.round(clamp(spot.y1 + pad, roof + CARD_HEIGHT * g.em, floor))
  return { left, top: null, bottom: g.H - end, maxHeight: Math.floor(end - roof) }
}

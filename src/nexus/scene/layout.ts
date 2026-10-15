import type { Archive, Nexus, Robot, Territory, World } from '../types'

/** Sprite sizes in art pixels (spec Q16): what `SPRITES` holds, drawn at `scale` CSS px each. */
export const ROBOT = 64
export const NEXUS = 96
export const ARCHIVE = 96
export const CORE = 128
export const PACKET = 16

/** How many robots one ring holds (contract, scene): the rest are counted as `+N` on the nexus. */
export const RING_MAX = 15

/** The largest scale drawn: past 2, one session and no children fill the drawer with a single core. */
const MAX_SCALE = 2
/** Art px between two neighbours on a ring. */
const ROBOT_GAP = 10
/** Art px over a robot's head that its badge takes. */
const BADGE = 20
/** CSS px under a sprite for its label (text does not scale with the art). */
export const LABEL = 18
/** CSS px a robot's label may take across (`.nexus-robot .nexus-label`'s max-width). */
export const ROBOT_LABEL = 72
/** CSS px over a territory for its name. */
const HEADER = 28
/** CSS px around a territory's content and between its items. */
const PAD = 12
/** CSS px between a territory's floor and its cell: the gutter between territories. */
const INSET = 4

export type Point = { x: number; y: number }
export type Rect = Point & { w: number; h: number }

/** A robot's box (its 64 px sprite, scaled), top-left at `x`, `y`; `cx`, `cy` is its centre. */
export type RobotSpot = Rect & { cx: number; cy: number; robot: Robot }
/** A nexus's centre, with the radius of its ring in CSS px and the robots drawn on it. */
export type NexusSpot = Point & { nexus: Nexus; r: number; robots: RobotSpot[]; hidden: number }
export type TerritorySpot = Rect & { territory: Territory; archive: Point; nexuses: NexusSpot[] }

export type SceneLayout = {
  /** CSS px per art pixel: a whole number of device pixels. */
  scale: number
  /** The scene's size; larger than the box only when even the smallest scale overflows it. */
  width: number
  height: number
  core: Point
  territories: TerritorySpot[]
}

/** The robots a ring draws, in world order: all of them up to `RING_MAX`, else the ones that need
 *  you first, so an overflowing ring never hides a robot asking for something. */
export function ringRobots(robots: Robot[]): { shown: Robot[]; hidden: number } {
  if (robots.length <= RING_MAX) return { shown: robots, hidden: 0 }
  const urgent = robots.filter((r) => r.halo === 'needs-you').slice(0, RING_MAX)
  const keep = new Set(urgent)
  for (const r of robots) if (keep.size < RING_MAX) keep.add(r)
  return { shown: robots.filter((r) => keep.has(r)), hidden: robots.length - RING_MAX }
}

/** CSS px a label of `text` takes: 11 px monospace is about 6.7 px a character. */
export const labelWidth = (text: string) => Math.ceil(text.length * 6.7) + 8

/** CSS px between a robot and its nexus, art and text included. */
const CLEAR = 4

/** Half the width a nexus takes: its sprite or its label (`.nexus-label`'s max-width), whichever is wider. */
const nexusHalf = (n: Nexus, s: number) => Math.max(NEXUS * s, Math.min(labelWidth(n.label), NEXUS * s + 32)) / 2
/** Half the width a robot takes: its sprite or its label, whichever is wider. */
const robotHalf = (r: Robot, s: number) => Math.max(ROBOT * s, Math.min(ROBOT_LABEL, labelWidth(r.label))) / 2

/** Where robot `i` of `n` stands on its ring: the first at the top, the rest clockwise, evenly apart. */
const angleOf = (i: number, n: number) => -Math.PI / 2 + (2 * Math.PI * i) / n

/** The ring's radius in CSS px at scale `s`: the ring holds what it has, so 0 with no robots. Wide
 *  enough for `robots` side by side, each as wide as its sprite or its label, whichever is wider:
 *  labels do not shrink with the art. Never on the nexus: each robot, with its badge over it and its
 *  label under it, clears the nexus's sprite and label where it stands. */
export function ringRadius(robots: Robot[], s: number, nexus: Nexus): number {
  if (!robots.length) return 0
  const label = Math.min(ROBOT_LABEL, Math.max(0, ...robots.map((r) => labelWidth(r.label))))
  const slot = Math.max((ROBOT + ROBOT_GAP) * s, label + 6)
  let r = (robots.length * slot) / (2 * Math.PI)
  const nx = nexusHalf(nexus, s)
  robots.forEach((robot, i) => {
    const a = angleOf(i, robots.length)
    const cos = Math.abs(Math.cos(a))
    const sin = Math.sin(a)
    // Clear beside the nexus, or above it (the robot's label over the sprite), or below it (the
    // robot's badge under the nexus's label): whichever comes first going out along the ring.
    const beside = cos > 1e-9 ? (robotHalf(robot, s) + nx + CLEAR) / cos : Infinity
    const above = sin < -1e-9 ? ((ROBOT / 2 + NEXUS / 2) * s + LABEL + CLEAR) / -sin : Infinity
    const below = sin > 1e-9 ? ((ROBOT / 2 + BADGE + NEXUS / 2) * s + LABEL + CLEAR) / sin : Infinity
    r = Math.max(r, Math.min(beside, above, below))
  })
  return Math.ceil(r)
}

/** The CSS px per art pixel that are whole device pixels, largest first, up to `MAX_SCALE`. */
export function scales(dpr: number): number[] {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const out: number[] = []
  for (let k = Math.max(1, Math.floor(MAX_SCALE * d)); k >= 1; k--) out.push(k / d)
  return out
}

/** What an archive's label says: its project and its live pages. */
export const archiveLabel = (a: Archive) => `${a.project} · ${a.pages}`
/** What the universal core's label says. */
export const coreLabel = (pages: number) => `universal · ${pages}`

type Item = { w: number; h: number; /** The anchor's offset inside the item. */ ax: number; ay: number }
type Packed = { w: number; h: number; at: Point[] }

/** A nexus's cluster, as tight as what it draws: its sprite and label, its ring, and each robot on
 *  it with its badge and label. A nexus with no robots takes little more than its own sprite. */
function cluster(n: Nexus, s: number): Item {
  const { shown } = ringRobots(n.robots)
  const r = ringRadius(shown, s, n)
  const nx = nexusHalf(n, s)
  // Robots are snapped to device pixels once placed: a pixel of slack on every side.
  let [x0, y0, x1, y1] = [-Math.max(nx, r), -Math.max((NEXUS / 2) * s, r), Math.max(nx, r), Math.max((NEXUS / 2) * s + LABEL, r)]
  shown.forEach((robot, i) => {
    const a = angleOf(i, shown.length)
    const cx = r * Math.cos(a)
    const cy = r * Math.sin(a)
    const h = robotHalf(robot, s)
    x0 = Math.min(x0, cx - h)
    x1 = Math.max(x1, cx + h)
    y0 = Math.min(y0, cy - (ROBOT / 2 + BADGE) * s)
    y1 = Math.max(y1, cy + (ROBOT / 2) * s + LABEL)
  })
  return { w: Math.ceil(x1 - x0) + 2, h: Math.ceil(y1 - y0) + 2, ax: -x0 + 1, ay: -y0 + 1 }
}

/** The archive, then one cluster per nexus. */
function items(t: Territory, s: number): Item[] {
  const w = Math.max(ARCHIVE * s, labelWidth(archiveLabel(t.archive)))
  const archive: Item = { w, h: ARCHIVE * s + LABEL, ax: w / 2, ay: (ARCHIVE * s) / 2 }
  return [archive, ...t.nexuses.map((n) => cluster(n, s))]
}

/** Shelves, left to right, each centred; null when an item is wider than `maxW`. An item shorter
 *  than its shelf stacks under an earlier one where the shelf has the height for it, so an archive
 *  and a nexus with no robots share the height of a ring beside them. `next` is the narrowest
 *  `maxW` past this one that would pack differently: Infinity when nothing was turned away. */
function pack(list: Item[], maxW: number): (Packed & { next: number }) | null {
  if (list.some((i) => i.w > maxW)) return null
  type Stack = { items: number[]; w: number; h: number }
  const shelves: Array<{ stacks: Stack[]; w: number; h: number }> = []
  let next = Infinity
  list.forEach((it, i) => {
    const last = shelves.at(-1)
    if (last) {
      for (const st of last.stacks) {
        if (st.h + PAD + it.h > last.h) continue
        const w = last.w - st.w + Math.max(st.w, it.w)
        if (w > maxW) {
          next = Math.min(next, w)
          continue
        }
        st.items.push(i)
        st.h += PAD + it.h
        st.w = Math.max(st.w, it.w)
        last.w = w
        return
      }
      const w = last.w + PAD + it.w
      if (w <= maxW) {
        last.stacks.push({ items: [i], w: it.w, h: it.h })
        last.w = w
        last.h = Math.max(last.h, it.h)
        return
      }
      next = Math.min(next, w)
    }
    shelves.push({ stacks: [{ items: [i], w: it.w, h: it.h }], w: it.w, h: it.h })
  })
  const at: Point[] = []
  let y = 0
  for (const sh of shelves) {
    let x = (maxW - sh.w) / 2
    for (const st of sh.stacks) {
      let sy = y + (sh.h - st.h) / 2
      for (const i of st.items) {
        at[i] = { x: x + (st.w - list[i].w) / 2, y: sy }
        sy += list[i].h + PAD
      }
      x += st.w + PAD
    }
    y += sh.h + PAD
  }
  return { w: Math.max(...shelves.map((s) => s.w)), h: y - PAD, at, next }
}

/** A territory's packs from narrowest to widest, each one shorter than the last: the height each
 *  width buys, up to `maxW`. */
type Profile = Array<{ w: number; h: number }>

function profile(list: Item[], maxW: number): Profile {
  const out: Profile = []
  let w = Math.max(...list.map((i) => i.w))
  while (w <= maxW) {
    const p = pack(list, w)!
    if (!out.length || p.h < out[out.length - 1].h) out.push({ w: p.w, h: p.h })
    w = p.next
  }
  return out
}

/** The cell nearest the grid's centre, which holds the universal core (ties go to the first). */
function centreCell(cols: number, rows: number): number {
  let best = 0
  let dist = Infinity
  for (let i = 0; i < cols * rows; i++) {
    const d = Math.hypot((i % cols) + 0.5 - cols / 2, Math.floor(i / cols) + 0.5 - rows / 2)
    if (d < dist - 1e-9) [best, dist] = [i, d]
  }
  return best
}

type Grid = {
  cols: number
  rows: number
  /** Each column's width and each row's height: what its territories (and the core) need, plus an
   *  even share of the room left. */
  colW: number[]
  rowH: number[]
  /** The cell holding the core; the territories fill the others in world order. */
  centre: number
  packs: Packed[]
  score: number
}

/** The cells the territories take, in world order: every cell but the core's. */
const territoryCells = (g: Pick<Grid, 'cols' | 'rows' | 'centre'>) => Array.from({ length: g.cols * g.rows }, (_, i) => i).filter((i) => i !== g.centre)

/** `need` plus a share of the room left, `room - Σ need`: first to even out each row (or column)
 *  with its mirror, so the middle one, which holds the core, sits in the middle; then by `weight`
 *  (evenly when no weight is set). Whole px that sum to `room` or less. */
function share(need: number[], weight: number[], room: number): number[] {
  const out = [...need]
  let left = room - need.reduce((a, b) => a + b, 0)
  for (let i = 0; i < out.length / 2; i++) {
    const j = out.length - 1 - i
    const small = out[i] < out[j] ? i : j
    const add = Math.min(left, Math.abs(out[i] - out[j]))
    out[small] += add
    left -= add
  }
  const w = weight.some((x) => x > 0) ? weight : weight.map(() => 1)
  const total = w.reduce((a, b) => a + b, 0)
  return out.map((n, i) => Math.floor(n + (left * w[i]) / total))
}

/** How many row-height combinations a grid tries before it settles for even rows. */
const COMBOS = 1024

/** Every territory packed into its cell; null when they do not fit. Rows and columns are not all
 *  alike: each row's height is picked from what its territories can pack to, each column is as
 *  narrow as its territories allow at those heights, and the grid that leaves the most room wins.
 *  The room left is then shared out, the width to the columns that hold territories, so a
 *  territory's nexuses spread across its floor rather than stack in one column. `score` is the
 *  share of the box left over, the same on both axes. */
function grid(ts: Territory[], its: Item[][], profiles: Profile[], s: number, cols: number, rows: number, W: number, H: number, coreText: string): Grid | null {
  const centre = centreCell(cols, rows)
  const cells = territoryCells({ cols, rows, centre })
  const coreW = Math.ceil(Math.max(CORE * s, labelWidth(coreText)) + 2 * PAD)
  const coreH = Math.ceil(CORE * s + LABEL + 2 * PAD)
  const rowOf = (ti: number) => Math.floor(cells[ti] / cols)
  const colOf = (ti: number) => cells[ti] % cols
  const extra = HEADER + PAD

  // Each row's heights to try: the ones its territories pack to, from the tallest a row must be.
  const options = Array.from({ length: rows }, (_, r) => {
    const mine = ts.map((_, ti) => ti).filter((ti) => rowOf(ti) === r)
    const floor = Math.max(r === Math.floor(centre / cols) ? coreH : 0, ...mine.map((ti) => Math.ceil(profiles[ti].at(-1)!.h + extra)))
    const hs = new Set([floor])
    for (const ti of mine) for (const st of profiles[ti]) if (st.h + extra > floor) hs.add(Math.ceil(st.h + extra))
    return [...hs].sort((a, b) => a - b)
  })
  // The last row takes the tallest height left: more height never costs a column width.
  const combos = options.slice(0, -1).reduce((n, o) => n * o.length, 1)

  /** The narrowest width each column can take when row `r` is `need[r]` tall; null past `W`. */
  const widths = (need: number[]): number[] | null => {
    const colW = Array.from({ length: cols }, () => 0)
    colW[centre % cols] = coreW
    for (const ti of ts.keys()) {
      const st = profiles[ti].find((p) => p.h + extra <= need[rowOf(ti)])
      if (!st) return null
      colW[colOf(ti)] = Math.max(colW[colOf(ti)], Math.ceil(st.w + 2 * PAD))
    }
    return colW.reduce((a, b) => a + b, 0) <= W ? colW : null
  }

  type Pick = { need: number[]; colW: number[]; score: number }
  // With an odd number of rows the core's is the middle one: rows as tall as their mirrors keep the
  // core in the middle of the drawer, and win whenever they fit.
  const odd = rows % 2 === 1 && rows > 1
  const picks: { even: Pick | null; any: Pick | null } = { even: null, any: null }
  const rate = (need: number[], into: 'even' | 'any') => {
    const tall = need.reduce((a, b) => a + b, 0)
    if (tall > H) return
    const colW = widths(need)
    if (!colW) return
    const score = Math.min(W / colW.reduce((a, b) => a + b, 0), H / tall)
    const was = picks[into]
    if (!was || score > was.score) picks[into] = { need, colW, score }
  }
  const consider = (need: number[]) => {
    rate(need, 'any')
    if (odd) rate(need.map((h, r) => Math.max(h, need[rows - 1 - r])), 'even')
  }
  if (combos <= COMBOS) {
    const walk = (r: number, need: number[], tall: number) => {
      if (r === rows - 1) {
        const fit = options[r].filter((h) => tall + h <= H)
        // The tallest that fits; with mirrored rows, any that fits, as the mirror adds to it.
        for (const h of odd ? fit : fit.slice(-1)) consider([...need, h])
        return
      }
      for (const h of options[r]) {
        if (tall + h > H) break
        walk(r + 1, [...need, h], tall + h)
      }
    }
    walk(0, [], 0)
  } else consider(Array.from({ length: rows }, (_, r) => Math.max(options[r][0], Math.floor(H / rows))))
  const best = picks.even ?? picks.any
  if (!best) return null
  const { need, colW: narrow, score } = best

  const colW = share(narrow, narrow.map((_, c) => (ts.some((_, ti) => colOf(ti) === c) ? 1 : 0)), W)
  const rowH = share(need, need.map(() => 1), H)
  // Packed across the column's whole width when that still fits the row, else as narrow as chosen.
  const packs = its.map((list, ti) => {
    const innerW = colW[colOf(ti)] - 2 * PAD
    const wide = pack(list, innerW)!
    if (wide.h + extra <= rowH[rowOf(ti)]) return wide
    const w = profiles[ti].find((p) => p.h + extra <= need[rowOf(ti)])!.w
    const p = pack(list, w)!
    return { ...p, at: p.at.map((a) => ({ x: a.x + (innerW - w) / 2, y: a.y })) }
  })
  return { cols, rows, colW, rowH, centre, packs, score }
}

/** Fewer empty cells first, so the core sits in the middle of a full grid rather than in the corner
 *  of a ragged one; then the most room left over. */
const better = (a: Grid, b: Grid) => {
  const ea = a.cols * a.rows - a.packs.length
  const eb = b.cols * b.rows - b.packs.length
  return ea !== eb ? ea < eb : a.score > b.score
}

/** Snap to whole device pixels, so a pixelated sprite never straddles one. */
const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr

/** Where everything goes (spec Q16, Q17): territories in a grid that fits `box` with the universal
 *  core in its middle cell, each territory's archive and nexus rings packed in shelves, robots on
 *  their ring starting at the top, all at the largest whole-device-pixel scale that fits. No camera:
 *  when even the smallest scale overflows, the scene grows past the box and the drawer scrolls. */
export function layOut(world: World, box: { w: number; h: number }, dpr: number): SceneLayout {
  const ts = world.territories
  const cells = ts.length + 1
  const W = Math.max(1, box.w)
  const H = Math.max(1, box.h)
  const all = scales(dpr)

  let chosen: { s: number; g: Grid } | null = null
  for (const s of all) {
    let best: Grid | null = null
    const its = ts.map((t) => items(t, s))
    const profiles = its.map((list) => profile(list, W))
    if (profiles.some((p) => !p.length)) continue
    for (let cols = 1; cols <= cells; cols++) {
      const g = grid(ts, its, profiles, s, cols, Math.ceil(cells / cols), W, H, coreLabel(world.universal.pages))
      if (g && (!best || better(g, best))) best = g
    }
    if (best) {
      chosen = { s, g: best }
      break
    }
  }
  if (!chosen) chosen = { s: all.at(-1)!, g: overflowGrid(ts, all.at(-1)!, W, cells) }

  const { s, g } = chosen
  const colX = g.colW.map((_, i) => g.colW.slice(0, i).reduce((a, b) => a + b, 0))
  const rowY = g.rowH.map((_, i) => g.rowH.slice(0, i).reduce((a, b) => a + b, 0))
  const cellAt = (i: number): Rect => {
    const [c, r] = [i % g.cols, Math.floor(i / g.cols)]
    return { x: colX[c], y: rowY[r], w: g.colW[c], h: g.rowH[r] }
  }
  const cellOf = territoryCells(g)
  const c = cellAt(g.centre)

  const territories = ts.map((t, ti): TerritorySpot => {
    const cell = cellAt(cellOf[ti])
    const p = g.packs[ti]
    const innerH = cell.h - HEADER - PAD
    const ox = cell.x + PAD
    const oy = cell.y + HEADER + Math.max(0, (innerH - p.h) / 2)
    const its = items(t, s)
    const anchor = (i: number): Point => ({ x: snap(ox + p.at[i].x + its[i].ax, dpr), y: snap(oy + p.at[i].y + its[i].ay, dpr) })
    const nexuses = t.nexuses.map((n, ni): NexusSpot => {
      const centreOf = anchor(ni + 1)
      const { shown, hidden } = ringRobots(n.robots)
      const r = ringRadius(shown, s, n)
      const robots = shown.map((robot, ri): RobotSpot => {
        const a = angleOf(ri, shown.length)
        const cx = snap(centreOf.x + r * Math.cos(a), dpr)
        const cy = snap(centreOf.y + r * Math.sin(a), dpr)
        const size = ROBOT * s
        return { robot, cx, cy, x: snap(cx - size / 2, dpr), y: snap(cy - size / 2, dpr), w: size, h: size }
      })
      return { ...centreOf, nexus: n, r, robots, hidden }
    })
    return { territory: t, x: cell.x + INSET, y: cell.y + INSET, w: cell.w - 2 * INSET, h: cell.h - 2 * INSET, archive: anchor(0), nexuses }
  })

  return {
    scale: s,
    width: g.colW.reduce((a, b) => a + b, 0),
    height: g.rowH.reduce((a, b) => a + b, 0),
    core: { x: snap(c.x + c.w / 2, dpr), y: snap(c.y + c.h / 2 - LABEL / 2, dpr) },
    territories,
  }
}

/** The smallest scale did not fit: as many equal columns as the widest item allows, each row as
 *  tall as the tallest territory needs. */
function overflowGrid(ts: Territory[], s: number, W: number, cells: number): Grid {
  const widest = Math.max(CORE * s, ...ts.flatMap((t) => items(t, s).map((i) => i.w))) + 2 * PAD
  const cols = Math.max(1, Math.min(cells, Math.floor(W / widest)))
  const cellW = Math.max(Math.floor(W / cols), Math.ceil(widest))
  const packs = ts.map((t) => pack(items(t, s), cellW - 2 * PAD)!)
  const cellH = Math.ceil(Math.max(CORE * s + LABEL + 2 * PAD, ...packs.map((p) => p.h + HEADER + 2 * PAD)))
  const rows = Math.ceil(cells / cols)
  return { cols, rows, colW: Array.from({ length: cols }, () => cellW), rowH: Array.from({ length: rows }, () => cellH), centre: centreCell(cols, rows), packs, score: 0 }
}

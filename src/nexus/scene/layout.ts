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

/** The ring's radius in CSS px at scale `s`. Never inside the core: the top robot's badge clears the
 *  core's label. Wide enough for `robots` side by side, each as wide as its sprite or its label,
 *  whichever is wider: labels do not shrink with the art. */
export function ringRadius(robots: Robot[], s: number): number {
  const label = Math.min(ROBOT_LABEL, Math.max(0, ...robots.map((r) => labelWidth(r.label))))
  const slot = Math.max((ROBOT + ROBOT_GAP) * s, label + 6)
  const min = (NEXUS / 2 + BADGE + ROBOT / 2) * s + LABEL + 4
  return Math.ceil(Math.max(min, (robots.length * slot) / (2 * Math.PI)))
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

/** The archive, then one cluster per nexus: a ring with its robots, their badges and labels. */
function items(t: Territory, s: number): Item[] {
  const w = Math.max(ARCHIVE * s, labelWidth(archiveLabel(t.archive)))
  const archive: Item = { w, h: ARCHIVE * s + LABEL, ax: w / 2, ay: (ARCHIVE * s) / 2 }
  return [
    archive,
    ...t.nexuses.map((n): Item => {
      const half = ringRadius(ringRobots(n.robots).shown, s) + (ROBOT / 2) * s
      return { w: 2 * half, h: 2 * half + BADGE * s + LABEL, ax: half, ay: half + BADGE * s }
    }),
  ]
}

/** Shelves, left to right, each centred; null when an item is wider than `maxW`. */
function pack(list: Item[], maxW: number): Packed | null {
  if (list.some((i) => i.w > maxW)) return null
  const shelves: Array<{ items: number[]; w: number; h: number }> = []
  list.forEach((it, i) => {
    const last = shelves.at(-1)
    if (last && last.w + PAD + it.w <= maxW) {
      last.items.push(i)
      last.w += PAD + it.w
      last.h = Math.max(last.h, it.h)
    } else shelves.push({ items: [i], w: it.w, h: it.h })
  })
  const at: Point[] = []
  let y = 0
  for (const sh of shelves) {
    let x = (maxW - sh.w) / 2
    for (const i of sh.items) {
      at[i] = { x, y: y + (sh.h - list[i].h) / 2 }
      x += list[i].w + PAD
    }
    y += sh.h + PAD
  }
  return { w: Math.max(...shelves.map((s) => s.w)), h: y - PAD, at }
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
  /** Each column's width: equal, except that in a single row the core's column is only as wide as
   *  the core, and the territories share the rest. */
  colW: number[]
  cellH: number
  /** The cell holding the core; the territories fill the others in world order. */
  centre: number
  packs: Packed[]
  score: number
}

/** The cells the territories take, in world order: every cell but the core's. */
const territoryCells = (g: Pick<Grid, 'cols' | 'rows' | 'centre'>) => Array.from({ length: g.cols * g.rows }, (_, i) => i).filter((i) => i !== g.centre)

function columns(W: number, cols: number, rows: number, centre: number, coreW: number): number[] {
  if (rows > 1 || cols === 1) return Array.from({ length: cols }, () => Math.floor(W / cols))
  const core = Math.ceil(coreW + 2 * PAD + 2 * INSET)
  const rest = Math.floor((W - core) / (cols - 1))
  return Array.from({ length: cols }, (_, i) => (i === centre ? core : rest))
}

/** Every territory packed into its cell; null when one does not fit. `score` is the tightest room
 *  left over, so the grid that leaves the most of it wins. */
function grid(ts: Territory[], s: number, cols: number, rows: number, W: number, H: number, coreText: string): Grid | null {
  const centre = centreCell(cols, rows)
  const coreW = Math.max(CORE * s, labelWidth(coreText))
  const colW = columns(W, cols, rows, centre, coreW)
  const cellH = Math.floor(H / rows)
  const innerH = cellH - HEADER - PAD
  if (coreW > colW[centre] - 2 * PAD || CORE * s + LABEL > cellH - 2 * PAD) return null
  const cells = territoryCells({ cols, rows, centre })
  const packs: Packed[] = []
  let score = Infinity
  for (const [ti, t] of ts.entries()) {
    const innerW = colW[cells[ti] % cols] - 2 * PAD
    const p = innerW > 0 ? pack(items(t, s), innerW) : null
    if (!p || p.h > innerH) return null
    packs.push(p)
    score = Math.min(score, innerW / p.w, innerH / p.h)
  }
  return { cols, rows, colW, cellH, centre, packs, score }
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
    for (let cols = 1; cols <= cells; cols++) {
      const g = grid(ts, s, cols, Math.ceil(cells / cols), W, H, coreLabel(world.universal.pages))
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
  const cellAt = (i: number): Rect => ({ x: colX[i % g.cols], y: Math.floor(i / g.cols) * g.cellH, w: g.colW[i % g.cols], h: g.cellH })
  const cellOf = territoryCells(g)
  const c = cellAt(g.centre)

  const territories = ts.map((t, ti): TerritorySpot => {
    const cell = cellAt(cellOf[ti])
    const p = g.packs[ti]
    const innerH = g.cellH - HEADER - PAD
    const ox = cell.x + PAD
    const oy = cell.y + HEADER + Math.max(0, (innerH - p.h) / 2)
    const its = items(t, s)
    const anchor = (i: number): Point => ({ x: snap(ox + p.at[i].x + its[i].ax, dpr), y: snap(oy + p.at[i].y + its[i].ay, dpr) })
    const nexuses = t.nexuses.map((n, ni): NexusSpot => {
      const centreOf = anchor(ni + 1)
      const { shown, hidden } = ringRobots(n.robots)
      const r = ringRadius(shown, s)
      const robots = shown.map((robot, ri): RobotSpot => {
        const a = -Math.PI / 2 + (2 * Math.PI * ri) / shown.length
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
    height: g.rows * g.cellH,
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
  return { cols, rows, colW: Array.from({ length: cols }, () => cellW), cellH, centre: centreCell(cols, rows), packs, score: 0 }
}

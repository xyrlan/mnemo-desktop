// A session's figure: a small constellation worked out from its id, so a session is recognised
// before its name is read (docs/superpowers/specs/2026-11-10-recreation-design.md, "One
// identity for a session"). It is the Console prototype's sigil and the Score prototype's
// figure made one: stars on a dial of twelve directions and two distances (so two figures
// differ by whole positions, not by a jitter the eye cannot see), joined in the order they
// were drawn (so the line crosses itself and makes a shape), one of them the bright one.

/** The box every figure is drawn in. */
export const FIGURE_BOX = 32
/** No two stars of a figure are closer than this, so they never read as one. */
export const FIGURE_APART = 5

const DIRECTIONS = 12
const NEAR = 5.5
const FAR = 11

export interface Constellation {
  /** `[x, y, r]` in the 32-unit box; the first is the bright star. */
  points: [number, number, number][]
  /** Pairs of indexes into `points`. */
  lines: [number, number][]
}

/** Four to six stars and the lines between them, from a string. Pure: the same id draws the
 *  same figure on every machine. */
export function constellation(id: string): Constellation {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h = h >>> 0 || 1
  const next = () => {
    h ^= h << 13
    h >>>= 0
    h ^= h >>> 17
    h ^= h << 5
    h >>>= 0
    return h / 4294967296
  }
  // a few turns first: ids that differ only at the end must not start alike
  for (let i = 0; i < 4; i++) next()

  const places: [number, number][] = []
  for (let d = 0; d < DIRECTIONS; d++) {
    const a = (d / DIRECTIONS) * Math.PI * 2 - Math.PI / 2
    for (const r of [NEAR, FAR]) places.push([FIGURE_BOX / 2 + Math.cos(a) * r, FIGURE_BOX / 2 + Math.sin(a) * r])
  }
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[places[i], places[j]] = [places[j], places[i]]
  }
  const n = 4 + Math.floor(next() * 3)
  const points: [number, number, number][] = []
  for (const [x, y] of places) {
    if (points.length === n) break
    if (points.every((p) => Math.hypot(p[0] - x, p[1] - y) >= FIGURE_APART)) points.push([round(x), round(y), points.length === 0 ? 2.2 : 1.15])
  }
  const lines: [number, number][] = []
  for (let i = 1; i < points.length; i++) lines.push([i - 1, i])
  // most figures close; the open ones are a family of their own
  if (next() < 0.7) lines.push([points.length - 1, 0])
  return { points, lines }
}

const round = (n: number) => Math.round(n * 100) / 100

/** How unlike two figures are: the number of star positions one has and the other lacks. Zero
 *  only for the same set of stars. */
export function figureDistance(a: Constellation, b: Constellation): number {
  const key = (p: [number, number, number]) => `${p[0]},${p[1]}`
  const mine = new Set(a.points.map(key))
  const theirs = new Set(b.points.map(key))
  let n = 0
  for (const k of mine) if (!theirs.has(k)) n++
  for (const k of theirs) if (!mine.has(k)) n++
  return n
}

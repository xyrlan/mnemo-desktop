export type Point = { x: number; y: number }
export type ForceOptions = { iterations?: number; spacing?: number; gravity?: number }

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** Node centres from a force simulation (Fruchterman–Reingold plus a pull to the centre),
 *  Obsidian-style: linked nodes cluster, unlinked ones fill a disc instead of the single
 *  column a layered layout gives them. Deterministic: seeded on a sunflower spiral in `ids`
 *  order, so the same graph always lands the same way. Links to unknown ids are ignored. */
export function layoutForce(ids: string[], links: [string, string][], opts: ForceOptions = {}): Record<string, Point> {
  const { iterations = 300, spacing = 220, gravity = 0.05 } = opts
  const n = ids.length
  const index = new Map(ids.map((id, i) => [id, i]))
  const pairs = links.flatMap(([a, b]) => {
    const i = index.get(a)
    const j = index.get(b)
    return i === undefined || j === undefined || i === j ? [] : [[i, j] as const]
  })
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = spacing * 0.6 * Math.sqrt(i)
    xs[i] = r * Math.cos(i * GOLDEN)
    ys[i] = r * Math.sin(i * GOLDEN)
  }
  const k = spacing
  const reach2 = (3 * k) ** 2
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  let temp = spacing
  for (let it = 0; it < iterations; it++) {
    dx.fill(0)
    dy.fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = xs[i] - xs[j]
        let ey = ys[i] - ys[j]
        let d2 = ex * ex + ey * ey
        if (d2 < 0.01) {
          // Coincident: push apart along a fixed direction so the result stays deterministic.
          ex = 0.1
          ey = 0.1 * ((i + j) % 2 ? 1 : -1)
          d2 = 0.02
        }
        // Repulsion only reaches a few spacings (the grid variant of FR): past that it would
        // only inflate the disc, which gravity then has to fight.
        if (d2 > reach2) continue
        const f = (k * k) / d2
        dx[i] += ex * f
        dy[i] += ey * f
        dx[j] -= ex * f
        dy[j] -= ey * f
      }
    }
    for (const [i, j] of pairs) {
      const ex = xs[i] - xs[j]
      const ey = ys[i] - ys[j]
      const d = Math.sqrt(ex * ex + ey * ey) || 0.1
      const f = d / k
      dx[i] -= ex * f
      dy[i] -= ey * f
      dx[j] += ex * f
      dy[j] += ey * f
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= xs[i] * gravity
      dy[i] -= ys[i] * gravity
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i])
      if (len > 0) {
        const step = Math.min(len, temp)
        xs[i] += (dx[i] / len) * step
        ys[i] += (dy[i] / len) * step
      }
    }
    temp = Math.max(1, temp * 0.985)
  }
  return Object.fromEntries(ids.map((id, i) => [id, { x: xs[i], y: ys[i] }]))
}

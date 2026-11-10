// The lattice: mnemo's centre piece, drawn live. Two nested geodesic shells (the dual of a
// subdivided icosahedron: hexagons with twelve pentagons), the inner one finer, and a spine
// rising from every cell of the outer one to end in a node, in hairline white, after the still
// generated with Higgsfield (src/ds/art/lattice-still.jpg, ART.md). As in the still, a spine
// pulls the shell up into a small tent where it leaves it, and the spines are read on the rim:
// the ones that point at the eye fade, so the shells in front stay clean.
// A node lights when mnemo hands a rule to a session; the mote leaves from where `node` says.
//
// It is the one thing in the app that turns at rest, so it is careful: nothing runs while the
// canvas is off screen, the window is hidden or motion is reduced; then one still is drawn.
// A frame allocates nothing.

type P3 = [number, number, number]

const PHI = (1 + Math.sqrt(5)) / 2

const norm = (p: P3): P3 => {
  const l = Math.hypot(p[0], p[1], p[2])
  return [p[0] / l, p[1] / l, p[2] / l]
}

function icosahedron(): { v: P3[]; f: [number, number, number][] } {
  const raw: P3[] = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ]
  return {
    v: raw.map(norm),
    f: [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ],
  }
}

export interface Shell {
  /** The shell's corners, on the unit sphere. */
  pts: P3[]
  /** Pairs of corners: three meet at every corner. */
  edges: [number, number][]
  /** The shell's faces: twelve pentagons, the rest hexagons. `centre` is on the unit sphere. */
  cells: { centre: P3; corners: number[] }[]
}

/** A shell: the dual of the icosahedron split `n` times. 20n² corners, 30n² edges, 10n² + 2
 *  cells. */
export function shell(n: number): Shell {
  const ico = icosahedron()
  const verts: P3[] = []
  const key = new Map<string, number>()
  const id = (p: P3): number => {
    const q = norm(p)
    const k = q.map((x) => Math.round(x * 1e5)).join(',')
    let i = key.get(k)
    if (i === undefined) {
      i = verts.length
      key.set(k, i)
      verts.push(q)
    }
    return i
  }
  const faces: [number, number, number][] = []
  for (const [a, b, c] of ico.f) {
    const A = ico.v[a], B = ico.v[b], C = ico.v[c]
    const at = (i: number, j: number) => {
      const k = n - i - j
      return id([(A[0] * k + B[0] * i + C[0] * j) / n, (A[1] * k + B[1] * i + C[1] * j) / n, (A[2] * k + B[2] * i + C[2] * j) / n])
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        faces.push([at(i, j), at(i + 1, j), at(i, j + 1)])
        if (i + j < n - 1) faces.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)])
      }
    }
  }
  const pts = faces.map(([a, b, c]) => norm([verts[a][0] + verts[b][0] + verts[c][0], verts[a][1] + verts[b][1] + verts[c][1], verts[a][2] + verts[b][2] + verts[c][2]]))
  const side = new Map<string, number>()
  const edges: [number, number][] = []
  const cells = verts.map((centre) => ({ centre, corners: [] as number[] }))
  faces.forEach((tri, fi) => {
    for (let e = 0; e < 3; e++) {
      cells[tri[e]].corners.push(fi)
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}:${b}` : `${b}:${a}`
      const other = side.get(k)
      if (other === undefined) side.set(k, fi)
      else edges.push([other, fi])
    }
  })
  return { pts, edges, cells }
}

/** How much of a spine shows, from where it points (`z`: 1 at the eye, 0 on the rim, -1 away):
 *  whole on the rim, gone when it points at the eye or straight away, fainter behind. */
export function rim(z: number): number {
  const t = Math.max(0, Math.min(1, (0.82 - Math.abs(z)) / 0.4))
  return t * t * (3 - 2 * t) * (z < 0 ? 0.6 : 1)
}

export interface LatticeOptions {
  /** Radians a second. */
  spin?: number
  /** Frames a second, at most. */
  fps?: number
  tilt?: number
}

export interface LatticeHandle {
  /** Light spine `i`'s node for a moment. */
  pulse(i: number): void
  /** Where spine `i`'s node is now, in CSS pixels of the canvas: where a mote leaves from. */
  node(i: number): { x: number; y: number }
  readonly spines: number
  /** Stop and let go of the canvas. */
  dispose(): void
}

/** How long a lit node stays lit. */
export const PULSE_MS = 1400

/** Unit points as one flat array, and room for where they land on the canvas. */
function flat(pts: P3[]) {
  const unit = new Float32Array(pts.length * 3)
  pts.forEach((p, i) => unit.set(p, i * 3))
  return { unit, at: new Float32Array(pts.length * 3), n: pts.length }
}

const BUCKETS = 4

export function createLattice(canvas: HTMLCanvasElement, options: LatticeOptions = {}): LatticeHandle {
  const opt = { spin: 0.06, fps: 30, tilt: 0.42, ...options }
  const ctx = canvas.getContext('2d')
  const outerShell = shell(3)
  const innerShell = shell(5)
  const outer = { ...flat(outerShell.pts), edges: Uint16Array.from(outerShell.edges.flat()) }
  const inner = { ...flat(innerShell.pts), edges: Uint16Array.from(innerShell.edges.flat()) }
  // A spine per cell of the outer shell. The twelve pentagons carry the long ones, the twenty
  // cells at the middle of the icosahedron's faces the middle ones, the rest the short ones:
  // the still's rhythm round the rim. Pentagons first, so the first thirty-two are the
  // symmetric set.
  const ico = icosahedron()
  const mids = ico.f.map(([a, b, c]) => norm([ico.v[a][0] + ico.v[b][0] + ico.v[c][0], ico.v[a][1] + ico.v[b][1] + ico.v[c][1], ico.v[a][2] + ico.v[b][2] + ico.v[c][2]]))
  const rank = (cell: Shell['cells'][number]) => (cell.corners.length === 5 ? 0 : mids.some((m) => m[0] * cell.centre[0] + m[1] * cell.centre[1] + m[2] * cell.centre[2] > 0.999) ? 1 : 2)
  const cells = outerShell.cells.map((cell) => ({ cell, rank: rank(cell) })).sort((a, b) => a.rank - b.rank)
  const REACH = [1.62, 1.4, 1.24]
  const LIFT = 1.07
  const spineCount = cells.length
  const spine = flat(cells.map((c) => c.cell.centre))
  const reach = Float32Array.from(cells.map((c) => REACH[c.rank]))
  const corners = cells.map((c) => Uint16Array.from(c.cell.corners))
  const weight = new Float32Array(spineCount)
  const pulses = new Map<number, number>()
  let angle = 0.6
  let raf = 0
  let last = 0
  let running = false
  let visible = true
  let gone = false
  let still = 0
  let box: { w: number; h: number; dpr: number; R: number; ink: number } | null = null

  const wrap = (i: number) => ((Math.trunc(i) % spineCount) + spineCount) % spineCount

  function measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = canvas.getBoundingClientRect()
    const w = Math.max(2, Math.round(r.width * dpr))
    const h = Math.max(2, Math.round(r.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    // the long spines reach 1.62 radii, and a lit node glows past its tip
    const R = Math.min(w, h) * 0.285
    // hairlines, a little heavier on a large canvas so the piece keeps its weight
    box = { w, h, dpr, R, ink: dpr * Math.max(0.85, Math.min(1.5, R / dpr / 230)) }
    return box
  }
  const size = () => box ?? measure()

  // Turn about the vertical axis, then tip towards the eye; a gentle perspective, the near
  // side a little larger, never a fisheye. `at` gets x, y on the canvas and z (towards the eye).
  function place(from: { unit: Float32Array; at: Float32Array; n: number }, a: number, r: number, cx: number, cy: number, R: number) {
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(opt.tilt), st = Math.sin(opt.tilt)
    const { unit, at } = from
    for (let i = 0; i < from.n * 3; i += 3) {
      const x = unit[i] * ca + unit[i + 2] * sa
      const z0 = -unit[i] * sa + unit[i + 2] * ca
      const y = unit[i + 1] * ct - z0 * st
      const z = unit[i + 1] * st + z0 * ct
      const k = 6 / (6 - (z * r) / R)
      at[i] = cx + x * r * k
      at[i + 1] = cy - y * r * k
      at[i + 2] = z
    }
  }
  /** Where a point `d` radii out along spine `i` lands: the same turn and perspective. */
  const out: [number, number] = [0, 0]
  function along(i: number, d: number, a: number, cx: number, cy: number, R: number) {
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(opt.tilt), st = Math.sin(opt.tilt)
    const u = spine.unit
    const x = u[i * 3] * ca + u[i * 3 + 2] * sa
    const z0 = -u[i * 3] * sa + u[i * 3 + 2] * ca
    const y = u[i * 3 + 1] * ct - z0 * st
    const z = u[i * 3 + 1] * st + z0 * ct
    const k = 6 / (6 - z * d)
    out[0] = cx + x * R * d * k
    out[1] = cy - y * R * d * k
    return out
  }

  function strokeShell(c: CanvasRenderingContext2D, s: { at: Float32Array; edges: Uint16Array }, lineWidth: number, alpha: number) {
    for (let pass = 0; pass < 2; pass++) {
      // the far side first, the near side over it
      c.beginPath()
      for (let e = 0; e < s.edges.length; e += 2) {
        const i = s.edges[e] * 3, j = s.edges[e + 1] * 3
        const far = s.at[i + 2] + s.at[j + 2] < 0
        if ((pass === 0) !== far) continue
        c.moveTo(s.at[i], s.at[i + 1])
        c.lineTo(s.at[j], s.at[j + 1])
      }
      c.strokeStyle = `rgba(255,255,255,${pass === 0 ? alpha * 0.13 : alpha})`
      c.lineWidth = pass === 0 ? lineWidth * 0.8 : lineWidth
      c.stroke()
    }
  }

  function draw(now: number) {
    if (!ctx) return
    const { w, h, dpr, R, ink } = size()
    const cx = w / 2, cy = h / 2
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    place(inner, -angle * 0.7 + 1, R * 0.56, cx, cy, R)
    place(outer, angle, R, cx, cy, R)
    place(spine, angle, R, cx, cy, R)
    strokeShell(ctx, inner, 0.8 * ink, 0.85)
    strokeShell(ctx, outer, 1.1 * ink, 0.95)

    for (let i = 0; i < spineCount; i++) weight[i] = rim(spine.at[i * 3 + 2])
    // The spines, in a few strokes: one per step of faintness.
    for (let b = 1; b <= BUCKETS; b++) {
      ctx.beginPath()
      let any = false
      for (let i = 0; i < spineCount; i++) {
        if (Math.ceil(weight[i] * BUCKETS) !== b) continue
        any = true
        const base = along(i, LIFT, angle, cx, cy, R)
        const bx = base[0], by = base[1]
        const tip = along(i, reach[i], angle, cx, cy, R)
        ctx.moveTo(bx, by)
        ctx.lineTo(tip[0], tip[1])
      }
      if (!any) continue
      ctx.strokeStyle = `rgba(255,255,255,${(0.8 * b) / BUCKETS})`
      ctx.lineWidth = 0.8 * ink
      ctx.stroke()
      // the tent: from towards each corner of the cell, along the shell, then up into the spine
      ctx.beginPath()
      for (let i = 0; i < spineCount; i++) {
        if (Math.ceil(weight[i] * BUCKETS) !== b) continue
        const base = along(i, LIFT, angle, cx, cy, R)
        const sx = spine.at[i * 3], sy = spine.at[i * 3 + 1]
        const cs = corners[i]
        for (let k = 0; k < cs.length; k++) {
          const p = cs[k] * 3
          ctx.moveTo(sx + (outer.at[p] - sx) * 0.62, sy + (outer.at[p + 1] - sy) * 0.62)
          ctx.quadraticCurveTo(sx + (outer.at[p] - sx) * 0.12, sy + (outer.at[p + 1] - sy) * 0.12, base[0], base[1])
        }
      }
      ctx.strokeStyle = `rgba(255,255,255,${(0.42 * b) / BUCKETS})`
      ctx.lineWidth = 0.7 * ink
      ctx.stroke()
      ctx.beginPath()
      for (let i = 0; i < spineCount; i++) {
        if (Math.ceil(weight[i] * BUCKETS) !== b || pulses.has(i)) continue
        const tip = along(i, reach[i], angle, cx, cy, R)
        ctx.moveTo(tip[0] + 1.5 * ink, tip[1])
        ctx.arc(tip[0], tip[1], 1.5 * ink, 0, Math.PI * 2)
      }
      ctx.fillStyle = `rgba(255,255,255,${b / BUCKETS})`
      ctx.fill()
    }
    // A lit node shows wherever its spine points.
    for (const [i, born] of pulses) {
      const t = still ? 0.5 : (now - born) / PULSE_MS
      if (t >= 1) {
        pulses.delete(i)
        continue
      }
      const glow = Math.max(0, Math.sin(Math.PI * Math.max(0, t)))
      const base = along(i, LIFT, angle, cx, cy, R)
      const bx = base[0], by = base[1]
      const tip = along(i, reach[i], angle, cx, cy, R)
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(tip[0], tip[1])
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, weight[i] * 0.8 + glow)})`
      ctx.lineWidth = 0.8 * ink
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(tip[0], tip[1], (1.5 + glow * 3) * ink, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, weight[i] + glow)})`
      ctx.shadowColor = 'rgba(255,255,255,0.9)'
      ctx.shadowBlur = 16 * dpr * glow
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }

  function frame(now: number) {
    raf = 0
    if (!running) return
    // a millisecond of slack: two frames of a 60 Hz display are 33.33 ms, a hair under 1000 / 30
    if (now - last >= 1000 / opt.fps - 1) {
      angle += opt.spin * Math.min(0.1, (now - last) / 1000)
      last = now
      draw(now)
    }
    raf = requestAnimationFrame(frame)
  }

  const root = canvas.closest('.mn')
  const prefers = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const reduced = () => !!canvas.closest('[data-motion="reduced"]') || !!prefers?.matches
  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  function start() {
    if (gone || running) return
    measure()
    if (reduced() || document.hidden || !visible) {
      draw(performance.now())
      return
    }
    // a node lit while nothing turned goes on from here as any other
    if (still) clearTimeout(still)
    still = 0
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const restart = () => {
    stop()
    start()
  }

  document.addEventListener('visibilitychange', restart)
  prefers?.addEventListener?.('change', restart)
  // the frame's motion switch flips an attribute on the root
  const switched = root && typeof MutationObserver !== 'undefined' ? new MutationObserver(restart) : null
  if (root) switched?.observe(root, { attributes: true, attributeFilter: ['data-motion'] })
  const seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((e) => {
    visible = e[e.length - 1].isIntersecting
    restart()
  })
  seen?.observe(canvas)
  const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    measure()
    if (!running) draw(performance.now())
  })
  sized?.observe(canvas)
  start()

  return {
    spines: spineCount,
    pulse(i) {
      if (gone) return
      const which = wrap(i)
      pulses.set(which, performance.now())
      if (running) return
      // Nothing turns: the node is lit as a state, then put out, with one timer and no loop.
      if (still) clearTimeout(still)
      still = window.setTimeout(() => {
        still = 0
        pulses.clear()
        if (!gone && !running) draw(performance.now())
      }, PULSE_MS)
      draw(performance.now())
    },
    node(i) {
      const { w, h, dpr, R } = size()
      const tip = along(wrap(i), reach[wrap(i)], angle, w / 2, h / 2, R)
      return { x: tip[0] / dpr, y: tip[1] / dpr }
    },
    dispose() {
      gone = true
      stop()
      if (still) clearTimeout(still)
      still = 0
      document.removeEventListener('visibilitychange', restart)
      prefers?.removeEventListener?.('change', restart)
      switched?.disconnect()
      seen?.disconnect()
      sized?.disconnect()
    },
  }
}

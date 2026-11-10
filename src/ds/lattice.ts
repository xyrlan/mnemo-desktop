// The lattice: mnemo's centre piece, drawn live. Two nested geodesic shells (the dual of a
// subdivided icosahedron: hexagons with twelve pentagons) and thirty-two spines ending in
// nodes, in hairline white, after the still generated with Higgsfield (src/ds/art/ART.md).
// A node lights when mnemo hands a rule to a session; the mote leaves from where `node` says.
//
// It is the one thing in the app that turns at rest, so it is careful: nothing runs while the
// canvas is off screen, the window is hidden or motion is reduced; then one still is drawn.

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

/** A shell: the points and edges of the dual of the icosahedron split `n` times. */
function shell(n: number): { pts: P3[]; edges: [number, number][] } {
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
  faces.forEach((tri, fi) => {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}:${b}` : `${b}:${a}`
      const other = side.get(k)
      if (other === undefined) side.set(k, fi)
      else edges.push([other, fi])
    }
  })
  return { pts, edges }
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

export function createLattice(canvas: HTMLCanvasElement, options: LatticeOptions = {}): LatticeHandle {
  const opt = { spin: 0.06, fps: 30, tilt: 0.42, ...options }
  const ctx = canvas.getContext('2d')
  const outer = shell(3)
  const inner = shell(2)
  const ico = icosahedron()
  // The twelve poles (long) and the twenty face centres (short): thirty-two, symmetric.
  const spines: P3[] = [...ico.v, ...ico.f.map(([a, b, c]) => norm([ico.v[a][0] + ico.v[b][0] + ico.v[c][0], ico.v[a][1] + ico.v[b][1] + ico.v[c][1], ico.v[a][2] + ico.v[b][2] + ico.v[c][2]]))]
  const reach = spines.map((_, i) => (i < 12 ? 1.58 : 1.3))
  const pulses = new Map<number, number>()
  let angle = 0.6
  let raf = 0
  let last = 0
  let running = false
  let visible = true
  let gone = false

  const wrap = (i: number) => ((i % spines.length) + spines.length) % spines.length

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const r = canvas.getBoundingClientRect()
    const w = Math.max(2, Math.round(r.width * dpr))
    const h = Math.max(2, Math.round(r.height * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    return { w, h, dpr, R: Math.min(w, h) * 0.29 }
  }

  const turn = (p: P3, a: number): P3 => {
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(opt.tilt), st = Math.sin(opt.tilt)
    const x = p[0] * ca + p[2] * sa
    const z = -p[0] * sa + p[2] * ca
    return [x, p[1] * ct - z * st, p[1] * st + z * ct]
  }
  /** A gentle perspective: the near side a little larger, never a fisheye. */
  const project = (p: P3, r: number, cx: number, cy: number, R: number): P3 => {
    const k = 6 / (6 - (p[2] * r) / R)
    return [cx + p[0] * r * k, cy - p[1] * r * k, p[2]]
  }

  function draw(now: number) {
    if (!ctx) return
    const { w, h, dpr, R } = size()
    const cx = w / 2, cy = h / 2
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    const strokeShell = (s: { pts: P3[]; edges: [number, number][] }, r: number, a: number, weight: number, base: number) => {
      const pts = s.pts.map((p) => project(turn(p, a), r, cx, cy, R))
      for (let pass = 0; pass < 2; pass++) {
        // the far side first, the near side over it
        ctx.beginPath()
        for (const [i, j] of s.edges) {
          const far = (pts[i][2] + pts[j][2]) / 2 < 0
          if ((pass === 0) !== far) continue
          ctx.moveTo(pts[i][0], pts[i][1])
          ctx.lineTo(pts[j][0], pts[j][1])
        }
        ctx.strokeStyle = `rgba(255,255,255,${pass === 0 ? base * 0.22 : base})`
        ctx.lineWidth = weight * dpr * (pass === 0 ? 0.8 : 1)
        ctx.stroke()
      }
    }
    strokeShell(inner, R * 0.52, -angle * 0.7 + 1, 0.8, 0.8)
    strokeShell(outer, R, angle, 1.05, 0.92)
    spines.forEach((p, i) => {
      const q = turn(p, angle)
      const a = project(q, R, cx, cy, R)
      const b = project(q, R * reach[i], cx, cy, R)
      const depth = 0.35 + (0.65 * (q[2] + 1)) / 2
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * depth})`
      ctx.lineWidth = 0.8 * dpr
      ctx.stroke()
      let glow = 0
      const born = pulses.get(i)
      if (born !== undefined) {
        const t = (now - born) / 1400
        if (t >= 1) pulses.delete(i)
        else glow = Math.max(0, Math.sin(Math.PI * Math.max(0, t)))
      }
      ctx.beginPath()
      ctx.arc(b[0], b[1], (1.6 + glow * 3.2) * dpr, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, depth + glow)})`
      if (glow) {
        ctx.shadowColor = 'rgba(255,255,255,0.9)'
        ctx.shadowBlur = 16 * dpr * glow
      }
      ctx.fill()
      ctx.shadowBlur = 0
    })
  }

  function frame(now: number) {
    raf = 0
    if (!running) return
    if (now - last >= 1000 / opt.fps) {
      angle += opt.spin * Math.min(0.1, (now - last) / 1000)
      last = now
      draw(now)
    }
    raf = requestAnimationFrame(frame)
  }

  const reduced = () => !!canvas.closest('[data-motion="reduced"]') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  function start() {
    if (gone || running) return
    if (reduced() || document.hidden || !visible) {
      draw(performance.now())
      return
    }
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const restart = () => {
    stop()
    start()
  }

  document.addEventListener('visibilitychange', restart)
  const seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((e) => {
    visible = e[0].isIntersecting
    restart()
  })
  seen?.observe(canvas)
  const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (!running) draw(performance.now())
  })
  sized?.observe(canvas)
  start()

  return {
    spines: spines.length,
    pulse(i) {
      pulses.set(wrap(i), performance.now())
      if (!running) draw(performance.now())
    },
    node(i) {
      const { w, h, dpr, R } = size()
      const b = project(turn(spines[wrap(i)], angle), R * reach[wrap(i)], w / 2, h / 2, R)
      return { x: b[0] / dpr, y: b[1] / dpr }
    },
    dispose() {
      gone = true
      stop()
      document.removeEventListener('visibilitychange', restart)
      seen?.disconnect()
      sized?.disconnect()
    },
  }
}

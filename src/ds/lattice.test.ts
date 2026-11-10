import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLattice, PULSE_MS, rim, shell, type LatticeHandle } from './lattice'

describe('a shell', () => {
  test.each([1, 2, 3, 5])('split %i times is the dual of the icosahedron: three edges at every corner, twelve pentagons', (n) => {
    const s = shell(n)
    expect(s.pts.length).toBe(20 * n * n)
    expect(s.edges.length).toBe(30 * n * n)
    expect(s.cells.length).toBe(10 * n * n + 2)
    const meet = new Array(s.pts.length).fill(0)
    for (const [a, b] of s.edges) {
      meet[a]++
      meet[b]++
    }
    expect(new Set(meet)).toEqual(new Set([3]))
    expect(s.cells.filter((c) => c.corners.length === 5).length).toBe(12)
    expect(s.cells.every((c) => c.corners.length === 5 || c.corners.length === 6)).toBe(true)
  })
})

describe('where a spine is read', () => {
  test('whole on the rim, gone at the eye and straight away, fainter behind', () => {
    expect(rim(0)).toBe(1)
    expect(rim(1)).toBe(0)
    expect(rim(-1)).toBe(0)
    expect(rim(0.9)).toBe(0)
    expect(rim(-0.2)).toBeLessThan(rim(0.2))
    expect(rim(0.6)).toBeGreaterThan(0)
    expect(rim(0.6)).toBeLessThan(rim(0.3))
  })
})

// A canvas that counts: how often it was wiped (one wipe is one frame drawn) and how large
// the nodes were drawn (a lit node is larger).
function stage({ reduced = false, width = 600, height = 400 } = {}) {
  const root = document.createElement('div')
  root.className = 'mn'
  if (reduced) root.dataset.motion = 'reduced'
  const canvas = document.createElement('canvas')
  root.appendChild(canvas)
  document.body.appendChild(root)
  canvas.getBoundingClientRect = () => ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) })
  const seen = { frames: 0, nodes: [] as number[] }
  const noop = () => {}
  const ctx = {
    clearRect: () => {
      seen.frames++
      seen.nodes = []
    },
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    fill: noop,
    arc: (_x: number, _y: number, r: number) => seen.nodes.push(r),
  }
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext']
  return { root, canvas, seen }
}

describe('the lattice', () => {
  let frames: (FrameRequestCallback | null)[] = []
  let clock = 0
  let made: LatticeHandle[] = []
  const make = (canvas: HTMLCanvasElement) => {
    const handle = createLattice(canvas)
    made.push(handle)
    return handle
  }
  /** One display frame, 60 to the second. */
  const tick = () => {
    clock += 1000 / 60
    const due = frames
    frames = []
    for (const f of due) f?.(clock)
  }
  const waiting = () => frames.filter(Boolean).length
  const lit = (nodes: number[]) => Math.max(...nodes) > Math.min(...nodes) * 2

  beforeEach(() => {
    frames = []
    clock = 0
    made = []
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = null
    })
  })
  afterEach(() => {
    for (const h of made) h.dispose()
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('turns at no more than thirty frames a second', () => {
    const { canvas, seen } = stage()
    make(canvas)
    for (let i = 0; i < 60; i++) tick()
    expect(seen.frames).toBeGreaterThanOrEqual(25)
    expect(seen.frames).toBeLessThanOrEqual(30)
  })

  test('with motion reduced it draws one still and asks for no frame', () => {
    const { canvas, seen } = stage({ reduced: true })
    make(canvas)
    expect(seen.frames).toBe(1)
    expect(waiting()).toBe(0)
    for (let i = 0; i < 30; i++) tick()
    expect(seen.frames).toBe(1)
  })

  test('stops when the window is hidden and goes on when it is back', () => {
    const { canvas, seen } = stage()
    make(canvas)
    tick()
    tick()
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(waiting()).toBe(0)
    const still = seen.frames
    for (let i = 0; i < 30; i++) tick()
    expect(seen.frames).toBe(still)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(waiting()).toBe(1)
    for (let i = 0; i < 30; i++) tick()
    expect(seen.frames).toBeGreaterThan(still)
  })

  test("follows the frame's motion switch while it runs", async () => {
    const { root, canvas, seen } = stage()
    make(canvas)
    tick()
    tick()
    root.dataset.motion = 'reduced'
    await vi.advanceTimersByTimeAsync(0)
    expect(waiting()).toBe(0)
    const still = seen.frames
    for (let i = 0; i < 30; i++) tick()
    expect(seen.frames).toBe(still)
    delete root.dataset.motion
    await vi.advanceTimersByTimeAsync(0)
    expect(waiting()).toBe(1)
  })

  test('a node lit while it turns swells and goes out', () => {
    const { canvas, seen } = stage()
    const lattice = make(canvas)
    tick()
    tick()
    expect(lit(seen.nodes)).toBe(false)
    lattice.pulse(5)
    for (let i = 0; i < 30; i++) tick()
    expect(lit(seen.nodes)).toBe(true)
    for (let i = 0; i < 90; i++) tick()
    expect(lit(seen.nodes)).toBe(false)
  })

  test('with motion reduced a lit node is a state: lit at once, put out later, never a loop', () => {
    const { canvas, seen } = stage({ reduced: true })
    const lattice = make(canvas)
    lattice.pulse(5)
    expect(seen.frames).toBe(2)
    expect(lit(seen.nodes)).toBe(true)
    expect(waiting()).toBe(0)
    vi.advanceTimersByTime(PULSE_MS - 1)
    expect(seen.frames).toBe(2)
    vi.advanceTimersByTime(2)
    expect(seen.frames).toBe(3)
    expect(lit(seen.nodes)).toBe(false)
    expect(waiting()).toBe(0)
    vi.advanceTimersByTime(10 * PULSE_MS)
    expect(seen.frames).toBe(3)
  })

  test('every node is inside the canvas, wherever it has turned to', () => {
    const { canvas } = stage({ width: 600, height: 400 })
    const lattice = make(canvas)
    expect(lattice.spines).toBe(92)
    for (let turn = 0; turn < 6; turn++) {
      for (let i = 0; i < lattice.spines; i++) {
        const { x, y } = lattice.node(i)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(600)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(400)
      }
      for (let i = 0; i < 600; i++) tick()
    }
  })

  test('a node is named by any whole number: the count wraps', () => {
    const { canvas } = stage({ reduced: true })
    const lattice = make(canvas)
    expect(lattice.node(lattice.spines + 3)).toEqual(lattice.node(3))
    expect(lattice.node(-1)).toEqual(lattice.node(lattice.spines - 1))
    expect(lattice.node(3)).not.toEqual(lattice.node(4))
  })

  test('let go, it asks for nothing more and a pulse draws nothing', () => {
    const { canvas, seen } = stage()
    const lattice = make(canvas)
    tick()
    lattice.dispose()
    expect(waiting()).toBe(0)
    const still = seen.frames
    lattice.pulse(2)
    for (let i = 0; i < 30; i++) tick()
    vi.advanceTimersByTime(2 * PULSE_MS)
    expect(seen.frames).toBe(still)
  })
})

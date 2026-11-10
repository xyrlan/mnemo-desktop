import { describe, expect, test } from 'vitest'
import { frame, glow, shape, STEPS, STILL, thread, WINDINGS, type Motion } from './draw'
import type { OrbLook } from './show'

const LOOKS: OrbLook[] = ['listening', 'thinking', 'speaking', 'waiting']

const points = (flat: Float32Array) => Array.from({ length: flat.length / 3 }, (_, i) => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]] as const)
const length = ([x, y, z]: readonly [number, number, number]) => Math.hypot(x, y, z)

describe('the thread', () => {
  test('is one unbroken line on the sphere: every point at its surface, each a short step from the last', () => {
    const line = points(thread())
    expect(line).toHaveLength(WINDINGS * STEPS + 1)
    for (const p of line) expect(length(p)).toBeCloseTo(1, 5)
    const steps = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1], p[2] - line[i][2]))
    // A turn of a great circle in STEPS points, give or take the plane's own drift.
    const arc = (2 * Math.PI) / STEPS
    expect(Math.max(...steps)).toBeLessThan(arc * 1.2)
    expect(Math.min(...steps)).toBeGreaterThan(arc * 0.8)
  })

  test('winds all the way round: it reaches every side of the sphere', () => {
    const line = points(thread())
    for (const axis of [0, 1, 2]) {
      expect(Math.max(...line.map((p) => p[axis]))).toBeGreaterThan(0.85)
      expect(Math.min(...line.map((p) => p[axis]))).toBeLessThan(-0.85)
    }
  })

  test('leaves an eye open in the middle of the weave: no turn passes through the axis', () => {
    // The axis is z: how near a point at the front comes to it, seen from the front.
    const front = points(thread()).filter((p) => p[2] > 0.5)
    expect(Math.min(...front.map((p) => Math.hypot(p[0], p[1])))).toBeGreaterThan(0.2)
  })

  test('trembles in and out of the sphere by its ripple, and not at all without one', () => {
    const radii = points(thread(0.08, 1.3)).map(length)
    expect(Math.max(...radii)).toBeGreaterThan(1.07)
    expect(Math.max(...radii)).toBeLessThanOrEqual(1.08 + 1e-6)
    expect(Math.min(...radii)).toBeLessThan(0.93)
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(0.92 - 1e-6)
    // The phase moves the tremble along the thread.
    expect(points(thread(0.08, 0))[7]).not.toEqual(points(thread(0.08, 2))[7])
  })
})

describe('a look', () => {
  test('listening and speaking swell and tremble with the level; thinking and waiting do not hear it', () => {
    for (const look of ['listening', 'speaking'] as const) {
      expect(shape(look, 1, 0).radius).toBeGreaterThan(shape(look, 0, 0).radius)
      expect(shape(look, 1, 0).ripple).toBeGreaterThan(shape(look, 0, 0).ripple)
      expect(glow(look, 1)).toBeGreaterThan(glow(look, 0))
    }
    for (const look of ['thinking', 'waiting'] as const) {
      expect(shape(look, 1, 0)).toEqual(shape(look, 0, 0))
      expect(shape(look, 1, 0).ripple).toBe(0)
      expect(glow(look, 1)).toBe(glow(look, 0))
    }
  })

  test('the microphone moves the thread more than the speaker does', () => {
    expect(shape('listening', 1, 0).ripple).toBeGreaterThan(shape('speaking', 1, 0).ripple)
  })

  test('thinking winds fastest, waiting slowest, and waiting breathes', () => {
    const turned = (look: OrbLook) => shape(look, 0, 1000).spin - shape(look, 0, 0).spin
    expect(turned('thinking')).toBeGreaterThan(turned('speaking'))
    expect(turned('speaking')).toBeGreaterThan(turned('listening'))
    expect(turned('listening')).toBeGreaterThan(turned('waiting'))
    expect(turned('waiting')).toBeGreaterThan(0)
    expect(shape('waiting', 0, 1400).radius).not.toBe(shape('waiting', 0, 0).radius)
  })

  test('the orb never outgrows its canvas, however loud', () => {
    for (const look of LOOKS) for (const t of [0, 700, 1400, 5000]) expect(shape(look, 1, t).radius * (1 + shape(look, 1, t).ripple)).toBeLessThan(1)
  })

  test('waiting is the dimmest, and no look is dark', () => {
    for (const look of LOOKS) expect(glow(look, 0)).toBeGreaterThanOrEqual(glow('waiting', 0))
    expect(glow('waiting', 0)).toBeGreaterThan(0.3)
    for (const look of LOOKS) expect(glow(look, 1)).toBeLessThanOrEqual(1)
  })
})

/** A canvas that records what was drawn on it: each stroke and fill with the styles it had. */
function canvas() {
  const calls: string[] = []
  const state: Record<string, unknown> = {}
  const say = (what: string, ...args: unknown[]) => calls.push(`${what}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(', ')})`)
  class Path {
    readonly at: string[] = []
    moveTo(x: number, y: number) {
      this.at.push(`M${x.toFixed(2)},${y.toFixed(2)}`)
    }
    lineTo(x: number, y: number) {
      this.at.push(`L${x.toFixed(2)},${y.toFixed(2)}`)
    }
  }
  ;(globalThis as { Path2D?: unknown }).Path2D = Path
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} })
      return (...args: unknown[]) => {
        const path = args[0] instanceof Path ? args[0] : null
        say(key, ...(path ? [`${path.at.length} points`, path.at.join(' ')] : args), key === 'stroke' ? String(target.strokeStyle) : '')
      }
    },
    set(target, key: string, value) {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls, state }
}

const drawn = (m: Motion, t: number) => {
  const { ctx, calls } = canvas()
  frame(ctx, 300, m, t)
  return calls
}

describe('a frame', () => {
  test('with no look, or faded out, clears the canvas and draws nothing', () => {
    expect(drawn({ look: null, level: 0, alpha: 1 }, 0)).toEqual(['clearRect(0.00, 0.00, 300.00, 300.00, )'])
    expect(drawn({ look: 'listening', level: 0.5, alpha: 0 }, 0)).toEqual(['clearRect(0.00, 0.00, 300.00, 300.00, )'])
  })

  test('draws the whole thread, split into what is behind the sphere and what is in front, and the rim', () => {
    const calls = drawn({ look: 'thinking', level: 0, alpha: 1 }, 0)
    const strokes = calls.filter((c) => c.startsWith('stroke('))
    expect(strokes).toHaveLength(3)
    const segments = strokes.slice(0, 2).map((s) => Number(/(\d+) points/.exec(s)![1]) / 2)
    // Every step of the thread is on one side or the other.
    expect(segments[0] + segments[1]).toBe(WINDINGS * STEPS)
    expect(segments[0]).toBeGreaterThan(WINDINGS * STEPS * 0.3)
    expect(segments[1]).toBeGreaterThan(WINDINGS * STEPS * 0.3)
    expect(calls.some((c) => c.startsWith('arc(150.00, 150.00'))).toBe(true)
  })

  test('what is behind is drawn fainter than what is in front', () => {
    const strokes = drawn({ look: 'thinking', level: 0, alpha: 1 }, 0).filter((c) => c.startsWith('stroke('))
    const opacity = (s: string) => Number(/\/ ([\d.]+)\)/.exec(s)![1])
    expect(opacity(strokes[0])).toBeLessThan(opacity(strokes[1]) / 2)
  })

  test('moves from one moment to the next', () => {
    const m: Motion = { look: 'thinking', level: 0, alpha: 1 }
    expect(drawn(m, 0)).not.toEqual(drawn(m, 500))
  })

  test('held still, it is the same at every moment and at every level but for its brightness', () => {
    const still = (look: OrbLook, level: number, t: number) => drawn({ look, level, alpha: 1, still: true }, t)
    for (const look of LOOKS) expect(still(look, 0.4, 0)).toEqual(still(look, 0.4, 9000))
    // Where the thread goes does not change with the level: only how bright it is.
    const place = (calls: string[]) => calls.filter((c) => c.startsWith('stroke(')).map((c) => c.replace(/rgb.*$/, ''))
    expect(place(still('listening', 0, 0))).toEqual(place(still('listening', 1, 0)))
    expect(still('listening', 0, 0)).not.toEqual(still('listening', 1, 0))
    // And it is the size it is said to hold.
    expect(still('speaking', 1, 0).some((c) => c.startsWith(`arc(150.00, 150.00, ${(150 * STILL.radius).toFixed(2)}`))).toBe(true)
  })

  test('fades as a whole by its alpha', () => {
    const { ctx, state } = canvas()
    frame(ctx, 300, { look: 'speaking', level: 0.2, alpha: 0.35 }, 0)
    expect(state.globalAlpha).toBe(0.35)
  })
})

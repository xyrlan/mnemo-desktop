/** The orb itself, on a 2D canvas (#506): a sphere wound from one thread, in hairlines, the same
 *  thread orb James's panel plays as a clip (`src/ds/art/james-orb.webm`). The orb's window is
 *  transparent and click-through, so a clip on a black ground cannot stand there: it is drawn.
 *
 *  Each look moves its own way: `listening` swells and the thread trembles with the microphone,
 *  `thinking` winds fast and tight, `speaking` swells with the speaker, `waiting` breathes slowly.
 *  Stilled (`Motion.still`), nothing turns or swells: the look is the word under the orb, and the
 *  level is how bright the thread is. `frame` is pure over its input but for the canvas, so the
 *  page decides when to draw (never while hidden). */
import type { OrbLook } from './show'

export type Motion = {
  look: OrbLook | null
  /** The level the look moves with, smoothed: the microphone's or the speaker's, 0–1. */
  level: number
  /** The orb's own opacity, 0–1: it fades out once the conversation is over. */
  alpha: number
  /** Reduced motion: the sphere holds its place and its size. */
  still?: boolean
}

/** How big the orb is, how far its thread trembles and how far it has turned, for a look at a
 *  level and a time (ms). */
export function shape(look: OrbLook, level: number, t: number): { radius: number; ripple: number; spin: number } {
  switch (look) {
    case 'listening':
      return { radius: 0.62 + 0.18 * level, ripple: 0.01 + 0.07 * level, spin: t / 2600 }
    case 'speaking':
      return { radius: 0.64 + 0.16 * level, ripple: 0.006 + 0.03 * level, spin: t / 2000 }
    case 'thinking':
      return { radius: 0.66, ripple: 0, spin: t / 900 }
    case 'waiting':
      return { radius: 0.6 + 0.04 * Math.sin(t / 900), ripple: 0, spin: t / 6000 }
  }
}

/** The orb held still: one size, no tremble, one place. */
export const STILL = { radius: 0.66, ripple: 0, spin: 0.4 }

/** How many times the thread goes round the sphere, and how many points draw one turn. */
export const WINDINGS = 26
export const STEPS = 56

/** The thread: one unbroken line wound `WINDINGS` times round a unit sphere. Each turn is a
 *  great circle whose plane has stepped round the axis since the last, and leans a little more or
 *  less, so the turns cross into a weave with an open eye in the middle. `ripple` makes the
 *  thread tremble in and out of the sphere, `phase` moves the tremble along it. Returns the
 *  points as `x, y, z` triples, `WINDINGS * STEPS + 1` of them. */
export function thread(ripple = 0, phase = 0): Float32Array {
  const n = WINDINGS * STEPS
  const out = new Float32Array((n + 1) * 3)
  for (let i = 0; i <= n; i++) {
    const turn = i / STEPS
    const u = turn * Math.PI * 2
    // The plane's normal goes once round the axis over the whole thread, leaning between a
    // wide eye and a narrow one twice on the way.
    const round = (turn / WINDINGS) * Math.PI * 2
    const lean = 0.98 + 0.26 * Math.sin(round * 2)
    const [sl, cl, sr, cr] = [Math.sin(lean), Math.cos(lean), Math.sin(round), Math.cos(round)]
    const [cu, su] = [Math.cos(u), Math.sin(u)]
    const r = 1 + ripple * Math.sin(u * 5 + phase)
    // e1 = (-sr, cr, 0) and e2 = (-cl·cr, -cl·sr, sl): the turn's own plane.
    out[i * 3] = r * (cu * -sr + su * -cl * cr)
    out[i * 3 + 1] = r * (cu * cr + su * -cl * sr)
    out[i * 3 + 2] = r * (su * sl)
  }
  return out
}

/** How bright the thread is drawn, 0–1: a look that hears or speaks lights with its level. */
export function glow(look: OrbLook, level: number): number {
  switch (look) {
    case 'listening':
    case 'speaking':
      return 0.62 + 0.38 * level
    case 'thinking':
      return 0.8
    case 'waiting':
      return 0.5
  }
}

/** Draws one frame of the orb at time `t` (ms) into a square `ctx` of side `size` px. */
export function frame(ctx: CanvasRenderingContext2D, size: number, m: Motion, t: number): void {
  ctx.clearRect(0, 0, size, size)
  if (!m.look || m.alpha <= 0) return
  const { radius, ripple, spin } = m.still ? STILL : shape(m.look, m.level, t)
  const c = size / 2
  const r = c * radius
  const lit = glow(m.look, m.level)

  ctx.save()
  ctx.globalAlpha = m.alpha

  // A dark ball behind the thread, soft at the edge: hairlines must read over any desktop.
  const ground = ctx.createRadialGradient(c, c, 0, c, c, r * 1.32)
  ground.addColorStop(0, 'rgb(0 0 0 / 0.82)')
  ground.addColorStop(0.72, 'rgb(0 0 0 / 0.74)')
  ground.addColorStop(1, 'rgb(0 0 0 / 0)')
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, size, size)

  // The sphere leans a little as it turns, so the weave is seen to be round.
  const tiltX = m.still ? 0.22 : 0.22 + 0.16 * Math.sin(t / 2300)
  const tiltY = m.still ? -0.12 : 0.2 * Math.sin(t / 3100)
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(tiltX), Math.cos(tiltX), Math.sin(tiltY), Math.cos(tiltY), Math.sin(spin), Math.cos(spin)]
  const points = thread(ripple, t / 140)
  const n = points.length / 3
  const back = new Path2D()
  const front = new Path2D()
  let px = 0
  let py = 0
  let pz = 0
  for (let i = 0; i < n; i++) {
    const [x0, y0, z0] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
    // spin about the axis, then lean about x and y
    const x1 = x0 * cz - y0 * sz
    const y1 = x0 * sz + y0 * cz
    const y2 = y1 * cx - z0 * sx
    const z2 = y1 * sx + z0 * cx
    const x = c + (x1 * cy + z2 * sy) * r
    const y = c + y2 * r
    const z = z2 * cy - x1 * sy
    if (i > 0) {
      const path = z + pz >= 0 ? front : back
      path.moveTo(px, py)
      path.lineTo(x, y)
    }
    px = x
    py = y
    pz = z
  }

  const hair = Math.max(1, size / 300)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = hair * 0.8
  ctx.strokeStyle = `rgb(255 255 255 / ${(0.16 * lit).toFixed(3)})`
  ctx.stroke(back)
  ctx.lineWidth = hair
  ctx.strokeStyle = `rgb(255 255 255 / ${(0.66 * lit).toFixed(3)})`
  ctx.shadowColor = `rgb(255 255 255 / ${(0.5 * lit).toFixed(3)})`
  ctx.shadowBlur = hair * (1.5 + 6 * m.level)
  ctx.stroke(front)
  ctx.shadowBlur = 0

  // The sphere's own edge, as the still has it.
  ctx.strokeStyle = `rgb(255 255 255 / ${(0.4 * lit).toFixed(3)})`
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

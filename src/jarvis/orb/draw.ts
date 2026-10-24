/** The orb itself, on a 2D canvas (#506): a soft glowing sphere whose rim ripples. Each look moves
 *  its own way: `listening` swells and ripples with the microphone, `thinking` swirls calmly,
 *  `speaking` swells with the speaker, `waiting` breathes slowly. `frame` is pure over its input
 *  but for the canvas, so the page decides when to draw (never while hidden). */
import type { OrbLook } from './show'

export type Motion = {
  look: OrbLook | null
  /** The level the look moves with, smoothed: the microphone's or the speaker's, 0–1. */
  level: number
  /** The orb's own opacity, 0–1: it fades out once the conversation is over. */
  alpha: number
}

/** Hues per look, in degrees: blue listening, violet thinking, teal speaking, a dim blue waiting. */
const HUE: Record<OrbLook, [number, number]> = {
  listening: [205, 250],
  thinking: [255, 300],
  speaking: [170, 215],
  waiting: [215, 235],
}

/** How far the rim ripples and how big the orb is, for a look at a level and a time (ms). */
export function shape(look: OrbLook, level: number, t: number): { radius: number; ripple: number; spin: number } {
  switch (look) {
    case 'listening':
      return { radius: 0.62 + 0.18 * level, ripple: 0.04 + 0.16 * level, spin: t / 1800 }
    case 'speaking':
      return { radius: 0.64 + 0.16 * level, ripple: 0.03 + 0.12 * level, spin: t / 1400 }
    case 'thinking':
      return { radius: 0.66, ripple: 0.05, spin: t / 700 }
    case 'waiting':
      return { radius: 0.6 + 0.05 * Math.sin(t / 900), ripple: 0.02, spin: t / 4000 }
  }
}

/** Draws one frame of the orb at time `t` (ms) into a square `ctx` of side `size` px. */
export function frame(ctx: CanvasRenderingContext2D, size: number, m: Motion, t: number): void {
  ctx.clearRect(0, 0, size, size)
  if (!m.look || m.alpha <= 0) return
  const { radius, ripple, spin } = shape(m.look, m.level, t)
  const [h1, h2] = HUE[m.look]
  const c = size / 2
  const r = c * radius

  ctx.save()
  ctx.globalAlpha = m.alpha
  ctx.globalCompositeOperation = 'lighter'

  // The glow behind it.
  const glow = ctx.createRadialGradient(c, c, r * 0.4, c, c, c)
  glow.addColorStop(0, `hsla(${h1}, 90%, 60%, 0.35)`)
  glow.addColorStop(1, `hsla(${h2}, 90%, 50%, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // Three rims, each rippling at its own phase, so the edge looks alive.
  for (let k = 0; k < 3; k++) {
    const phase = spin * (k % 2 ? -1 : 1) + (k * Math.PI * 2) / 3
    ctx.beginPath()
    const steps = 64
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const wave = Math.sin(a * (3 + k) + phase) * 0.6 + Math.sin(a * (5 + k) - phase * 1.3) * 0.4
      const rr = r * (1 - 0.08 * k + ripple * wave)
      const x = c + Math.cos(a) * rr
      const y = c + Math.sin(a) * rr
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.closePath()
    const hue = h1 + ((h2 - h1) * k) / 2
    const fill = ctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r * 1.1)
    fill.addColorStop(0, `hsla(${hue}, 95%, 75%, 0.55)`)
    fill.addColorStop(0.6, `hsla(${hue}, 90%, 55%, 0.28)`)
    fill.addColorStop(1, `hsla(${hue + 20}, 90%, 40%, 0.05)`)
    ctx.fillStyle = fill
    ctx.fill()
  }

  // The bright core.
  const core = ctx.createRadialGradient(c, c, 0, c, c, r * 0.55)
  core.addColorStop(0, `hsla(${h1}, 100%, 92%, ${0.5 + 0.4 * m.level})`)
  core.addColorStop(1, `hsla(${h1}, 100%, 70%, 0)`)
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(c, c, r * 0.55, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

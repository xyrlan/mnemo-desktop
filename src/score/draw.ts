// The canvases: the score itself, its ruler and the fleet strip above it. Every function here
// draws once and returns; nothing schedules a frame. What moves (the playhead, the waiting
// dashes, the pulses) is DOM over the canvas, so a replay or an animation never redraws it.

import { tokens } from '../world/format'
import type { Session } from '../world/types'
import { BUCKET, MIN, fleet, fmt, lastAtOrBefore, mergedOf, planWindow, step, ticks, type Act, type Fleet, type Mark, type Row, type Score, type Sight } from './model'

const ink = (a: number) => `rgba(255,255,255,${a})`

/** What the canvases take from the frame's tokens: the signal hues, the typefaces, and the
 *  root size every length here is scaled by. */
export interface Look {
  need: string
  working: string
  ready: string
  stalled: string
  memory: string
  display: string
  text: string
  mono: string
  /** The frame's root size over 16px: 1 at 2560 wide, 0.78 at 1366. */
  u: number
}

const FALLBACK: Look = {
  need: '#ffb020', working: '#7dd3fc', ready: '#34d399', stalled: '#f87171', memory: '#c4b5fd',
  display: "'Jura Variable', 'Geist Variable', system-ui, sans-serif",
  text: "'Geist Variable', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  u: 1,
}

/** The look in force where `el` stands: the ds tokens, read once per draw. */
export function lookOf(el: Element | null): Look {
  if (!el || typeof getComputedStyle !== 'function') return FALLBACK
  const css = getComputedStyle(el)
  const read = (name: string, or: string) => css.getPropertyValue(name).trim() || or
  const px = parseFloat(css.fontSize)
  return {
    need: read('--need', FALLBACK.need),
    working: read('--working', FALLBACK.working),
    ready: read('--ready', FALLBACK.ready),
    stalled: read('--stalled', FALLBACK.stalled),
    memory: read('--memory', FALLBACK.memory),
    display: read('--display', FALLBACK.display),
    text: read('--text', FALLBACK.text),
    mono: read('--mono', FALLBACK.mono),
    u: Number.isFinite(px) && px > 0 ? px / 16 : 1,
  }
}

/** Where a row sits in the scrolling content: its top, its height, and its height before a
 *  waiting card opened in it. */
export interface Box {
  y: number
  h: number
  h0: number
}

export interface Env {
  /** The track's width and the visible height, in CSS pixels; `top` is how far it is scrolled. */
  W: number
  H: number
  top: number
  from: number
  to: number
  /** Pixels per millisecond. */
  k: number
  sc: Score
  rows: Row[]
  boxes: Box[]
  sel: string | null
  /** The selected line and its tree: what the strip draws in white. */
  pick: ReadonlySet<string> | null
  look: Look
}

export const xOf = (env: Pick<Env, 'from' | 'k'>, t: number): number => (t - env.from) * env.k
export const tOf = (env: Pick<Env, 'from' | 'k'>, px: number): number => env.from + px / env.k

type Ctx = CanvasRenderingContext2D

/** Size a canvas for the screen's pixel ratio and return a context in CSS pixels; null where
 *  there is no canvas to draw on. */
function fit(canvas: HTMLCanvasElement, width: number, height: number): Ctx | null {
  if (width < 1 || height < 1) return null
  const ratio = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(width * ratio))
  const h = Math.max(1, Math.round(height * ratio))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

export const isCompact = (row: Row): boolean => row.type === 'session' && (row.depth > 0 || row.s.role === 'child')

export interface Geom {
  /** The memory lane, the curve's ceiling (a full window), the line, the tool lanes, the foot. */
  yD: number
  yT: number
  yB: number
  lanes: number[]
  bottom: number
  compact: boolean
}

/** Where things sit inside a row. */
export function geom(row: Row, box: Box): Geom {
  const y = box.y
  const h = box.h0 || box.h
  if (isCompact(row)) {
    const f = h / 32
    return { yD: y + 6 * f, yT: y + 9 * f, yB: Math.round(y + 21 * f), lanes: [Math.round(y + 25 * f)], bottom: y + 29 * f, compact: true }
  }
  const f = h / 80
  const gap = 5 * Math.min(1.2, Math.max(0.8, f))
  const yB = y + Math.round(Math.min(h, 104) * 0.64)
  return { yD: y + 9 * f, yT: y + 16 * f, yB, lanes: [1, 2, 3, 4].map((n) => Math.round(yB + gap * n)), bottom: yB + gap * 4 + 4, compact: false }
}

function diamond(ctx: Ctx, x: number, y: number, r: number, fill: boolean) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  if (fill) ctx.fill()
  else ctx.stroke()
}
function cross(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x - r, y - r)
  ctx.lineTo(x + r, y + r)
  ctx.moveTo(x + r, y - r)
  ctx.lineTo(x - r, y + r)
  ctx.stroke()
}
function ring(ctx: Ctx, x: number, y: number, r: number, fill: boolean) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (fill) ctx.fill()
  else ctx.stroke()
}
function triangle(ctx: Ctx, x: number, y: number, r: number, fill: boolean) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y + r * 0.8)
  ctx.lineTo(x - r, y + r * 0.8)
  ctx.closePath()
  if (fill) ctx.fill()
  else ctx.stroke()
}
/** Text that stays readable over marks: a black edge under the letters. */
function label(ctx: Ctx, text: string, x: number, y: number, colour: string) {
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.lineJoin = 'round'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = colour
  ctx.fillText(text, x, y)
  ctx.lineWidth = 1
}
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text)

/** A size that follows the frame's root size without going under what can be read. */
const sized = (look: Look, px: number) => Math.max(px * 0.86, px * look.u)
const face = (look: Look, weight: number, px: number, family: 'display' | 'text' | 'mono') => `${weight} ${sized(look, px).toFixed(1)}px ${look[family]}`

/* ---- the ruler ---- */

export function drawRuler(canvas: HTMLCanvasElement, env: Env, H: number): void {
  const { W, look } = env
  const ctx = fit(canvas, W, H)
  if (!ctx) return
  ctx.font = face(look, 600, 11, 'display')
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink(0.12)
  ctx.fillRect(0, H - 1, W, 1)
  for (const tick of ticks(env.from, env.to, W)) {
    const px = Math.round(xOf(env, tick.t)) + 0.5
    ctx.strokeStyle = ink(tick.day ? 0.8 : tick.major ? 0.4 : 0.16)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, H - (tick.major ? 9 : 4))
    ctx.lineTo(px, H)
    ctx.stroke()
    if (!tick.major) continue
    const text = tick.day ? fmt.day(tick.t).toUpperCase() : fmt.clock(tick.t)
    if (px + 6 + ctx.measureText(text).width > W - 4) continue
    ctx.fillStyle = ink(tick.day ? 0.95 : 0.6)
    ctx.fillText(text, px + 6, H / 2 - 1)
  }
}

/* ---- the fleet strip ---- */

export interface Strip {
  fleet: Fleet
  peak: number
  stepMs: number
}

/** The interval the strip's bars are counted in, for a span and a width. */
export const stripStep = (env: Pick<Env, 'from' | 'to' | 'W'>): number => step(env.to - env.from, env.W, 7)

/** Tokens per interval across the axis, with their peak: what the strip draws. */
export function stripOf(env: Pick<Env, 'from' | 'to' | 'W' | 'sc' | 'pick'>): Strip {
  const stepMs = stripStep(env)
  const made = fleet(env.sc, env.from, env.to, stepMs, env.pick)
  let peak = 0
  for (let i = 0; i < made.n; i++) peak = Math.max(peak, made.total[i])
  return { fleet: made, peak, stepMs }
}

export function drawStrip(canvas: HTMLCanvasElement, env: Env, H: number, strip: Strip): void {
  const { W, sc, look } = env
  const { fleet: made, peak, stepMs } = strip
  const ctx = fit(canvas, W, H)
  if (!ctx) return

  const accounts = sc.world.accounts
  const laneH = sized(look, accounts.length > 3 ? 12 : 16)
  const top = sized(look, 30)
  const bottom = H - 6 - accounts.length * laneH
  const barW = Math.max(1, stepMs * env.k - 2)

  ctx.fillStyle = ink(0.1)
  ctx.fillRect(0, bottom + 0.5, W, 1)
  if (peak > 0) {
    for (let i = 0; i < made.n; i++) {
      const v = made.total[i]
      if (!v) continue
      const px = xOf(env, (made.first + i) * stepMs) + 1
      const h = Math.max(1.5, (v / peak) * (bottom - top))
      ctx.fillStyle = ink(env.pick ? 0.2 : 0.55)
      ctx.fillRect(px, bottom - h, barW, h)
      if (!env.pick) {
        ctx.fillStyle = ink(0.95)
        ctx.fillRect(px, bottom - h, barW, 1.5)
      }
      const p = made.picked[i]
      if (p) {
        const ph = Math.max(1.5, (p / peak) * (bottom - top))
        ctx.fillStyle = ink(0.95)
        ctx.fillRect(px, bottom - ph, barW, ph)
      }
    }
  }

  // One lane per account: what its sessions spent, under a bracket for its 5-hour window.
  // (A weekly window is longer than this axis; its figure is in the top bar.)
  ctx.textBaseline = 'middle'
  accounts.forEach((account, n) => {
    const y = bottom + 4 + n * laneH
    const used = made.accounts[account.id]
    let max = 0
    for (let i = 0; i < made.n; i++) max = Math.max(max, used[i])
    for (let i = 0; i < made.n && max; i++) {
      if (!used[i]) continue
      ctx.fillStyle = ink(0.14 + 0.5 * (used[i] / max))
      ctx.fillRect(xOf(env, (made.first + i) * stepMs) + 1, y + laneH - 7, barW, 3)
    }
    const name = String(account.label || account.id).toUpperCase()
    const ly = Math.round(y + 3) + 0.5
    ctx.font = face(look, 600, 10, 'display')
    const nameEnd = 12 + ctx.measureText(name).width
    for (const limit of account.limits) {
      const win = planWindow(limit)
      if (!win || limit.kind !== 'session' || win.to < env.from || win.from > env.to) continue
      const a = Math.max(-2, xOf(env, win.from))
      const b = Math.min(W + 2, xOf(env, Math.min(win.to, sc.now)))
      ctx.strokeStyle = ink(0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a, ly + 4)
      ctx.lineTo(a, ly)
      ctx.lineTo(b, ly)
      if (win.to <= sc.now) ctx.lineTo(b, ly + 4)
      ctx.stroke()
      const at = Math.max(a + 8, nameEnd + 14)
      ctx.font = face(look, 600, 9, 'display')
      if (b - at > 170) label(ctx, `5H WINDOW · ${Math.round(limit.percent)}% USED${win.to <= sc.now ? ' · OVER' : ''}`, at, ly + 0.5, ink(0.62))
      ctx.font = face(look, 600, 10, 'display')
    }
    label(ctx, name, 12, ly + 0.5, ink(account.active ? 0.85 : 0.5))
  })
}

/* ---- the score ---- */

export function drawScore(canvas: HTMLCanvasElement, env: Env): void {
  const { W, H } = env
  const ctx = fit(canvas, W, H)
  if (!ctx) return
  ctx.lineWidth = 1

  // the ruler's ticks carried down, faint
  for (const tick of ticks(env.from, env.to, W)) {
    if (!tick.major) continue
    ctx.fillStyle = ink(tick.day ? 0.14 : 0.045)
    ctx.fillRect(Math.round(xOf(env, tick.t)), 0, 1, H)
  }

  ctx.save()
  ctx.translate(0, -env.top)
  const at = new Map<string, number>()
  env.rows.forEach((row, i) => {
    if (row.type === 'session') at.set(row.s.id, i)
  })
  const seen = (i: number) => {
    const b = env.boxes[i]
    return !!b && b.y + b.h >= env.top - 4 && b.y <= env.top + H + 4
  }
  const lineY = (i: number) => geom(env.rows[i], env.boxes[i]).yB

  // branches first, under the lines they join
  env.rows.forEach((row, i) => {
    if (!env.boxes[i]) return
    if (row.type === 'session' && row.depth > 0) {
      const p = row.s.parent ? at.get(row.s.parent) : undefined
      if (p != null && env.boxes[p] && (seen(i) || seen(p))) branch(ctx, env, lineY(p), lineY(i), env.sc.line(row.s).t0, env.sel === row.s.id || env.sel === row.s.parent ? 0.6 : 0.3)
    } else if (row.type === 'ensemble') {
      const p = at.get(row.parent.id)
      if (p != null && env.boxes[p] && (seen(i) || seen(p))) {
        row.sessions.forEach((k, n) => {
          if (k.parent === row.parent.id) branch(ctx, env, lineY(p), ensembleY(env.boxes[i], n), env.sc.line(k).t0, 0.16)
        })
      }
    }
  })

  env.rows.forEach((row, i) => {
    if (!env.boxes[i] || !seen(i)) return
    if (row.type === 'ensemble') ensemble(ctx, env, row, env.boxes[i])
    else session(ctx, env, row, env.boxes[i])
  })
  ctx.restore()
}

const ensembleY = (box: Box, n: number) => box.y + box.h * (0.25 + (n % 3) * 0.22)

function branch(ctx: Ctx, env: Env, fromY: number, toY: number, t0: number | null, alpha: number) {
  if (t0 == null) return
  const px = xOf(env, t0)
  if (px < -20 || px > env.W + 20) return
  ctx.strokeStyle = ink(alpha)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px, fromY)
  ctx.bezierCurveTo(px, fromY + (toY - fromY) * 0.75, px, toY, px + 12, toY)
  ctx.stroke()
  ctx.fillStyle = ink(alpha + 0.3)
  ring(ctx, px, fromY, 2, true)
}

function ensemble(ctx: Ctx, env: Env, row: Extract<Row, { type: 'ensemble' }>, box: Box) {
  const { W, look } = env
  row.sessions.forEach((k, n) => {
    const d = env.sc.line(k)
    if (d.t0 == null || d.t1 == null) return
    const y = Math.round(ensembleY(box, n))
    const a = xOf(env, d.t0) + 12
    const b = xOf(env, d.t1)
    if (b < 0 || a > W) return
    ctx.fillStyle = ink(0.22)
    ctx.fillRect(Math.max(a, 0), y, Math.max(1, Math.min(b, W) - Math.max(a, 0)), 1)
    const bw = Math.max(1, BUCKET * env.k - 0.5)
    for (const bucket of d.buckets) {
      if (bucket.t + BUCKET < env.from || bucket.t > env.to || !bucket.total) continue
      ctx.fillStyle = ink(0.25 + 0.55 * Math.min(1, bucket.total / 12))
      ctx.fillRect(xOf(env, bucket.t), y - 1, bw, 3)
    }
    const merged = mergedOf(k)
    ctx.fillStyle = merged ? look.ready : ink(0.55)
    ring(ctx, b, y + 0.5, merged ? 2.4 : 1.6, true)
  })
}

function session(ctx: Ctx, env: Env, row: Extract<Row, { type: 'session' }>, box: Box) {
  const { W, sc, look } = env
  const now = sc.now
  const s = row.s
  const d = sc.line(s)
  const g = geom(row, box)
  const m = Math.max(0.8, look.u)
  const selected = env.sel === s.id
  const waits = sc.pend(s)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = face(look, 400, 11.5, 'text')

  if (d.t0 == null || d.t1 == null) {
    ctx.fillStyle = ink(0.22)
    ctx.fillText('nothing of it is known yet', 14 + row.depth * 14, g.yB)
    return
  }
  const endT = s.live || waits ? now : d.t1
  const x0 = xOf(env, d.t0) + (row.depth > 0 ? 12 : 0)
  const x1 = xOf(env, d.t1)
  const xEnd = xOf(env, endT)
  if (xEnd < 0) {
    ctx.fillStyle = ink(0.25)
    ctx.fillText(`◂  last active ${fmt.span(now - d.t1)} ago`, 14 + row.depth * 14, g.yB)
    return
  }
  if (x0 > W) return
  const left = Math.max(x0, -2)
  const right = Math.min(x1, W + 2)
  const curveH = g.yB - g.yT
  const yOf = (n: number) => g.yB - Math.min(1.04, n / d.window) * curveH

  // the ceiling: a full context window
  ctx.strokeStyle = ink(selected ? 0.3 : 0.09)
  ctx.setLineDash([1, 5])
  ctx.beginPath()
  ctx.moveTo(left, Math.round(g.yT) + 0.5)
  ctx.lineTo(Math.min(xEnd, W), Math.round(g.yT) + 0.5)
  ctx.stroke()
  ctx.setLineDash([])

  // the context: each call's size, held until the next call; a compaction is a cliff
  const pts = d.series
  if (pts.length) {
    let i = Math.max(0, lastAtOrBefore(pts, env.from, (p) => p[0]))
    const path: [number, number][] = []
    let px = Math.max(xOf(env, pts[i][0]), -4)
    let py = yOf(pts[i][1])
    path.push([px, py])
    for (i += 1; i < pts.length && pts[i][0] <= env.to; i++) {
      const nx = xOf(env, pts[i][0])
      if (nx - px < 0.4 && i + 1 < pts.length) {
        py = yOf(pts[i][1])
        path[path.length - 1][1] = Math.min(path[path.length - 1][1], py)
        continue
      }
      path.push([nx, py])
      px = nx
      py = yOf(pts[i][1])
      path.push([px, py])
    }
    const tail = Math.min(i < pts.length ? xOf(env, pts[i][0]) : xOf(env, endT), W + 2)
    path.push([tail, py])
    const fill = ctx.createLinearGradient(0, g.yT, 0, g.yB)
    fill.addColorStop(0, ink(selected ? 0.4 : 0.26))
    fill.addColorStop(1, ink(selected ? 0.06 : 0.03))
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(path[0][0], g.yB)
    for (const p of path) ctx.lineTo(p[0], p[1])
    ctx.lineTo(tail, g.yB)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = ink(selected ? 0.95 : 0.7)
    ctx.lineWidth = selected ? 1.4 : 1
    // the soft glow of the identity, on the one shape that carries a line
    ctx.shadowColor = 'rgba(255,255,255,0.6)'
    ctx.shadowBlur = (selected ? 14 : 8) * (window.devicePixelRatio || 1)
    ctx.beginPath()
    path.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
    ctx.stroke()
    ctx.shadowBlur = 0
    // nearly full is a signal: the top of the curve turns amber above 85%
    const hot = g.yB - 0.85 * curveH
    ctx.strokeStyle = look.need
    ctx.beginPath()
    for (let n = 1; n < path.length; n++) {
      if (path[n][1] <= hot && path[n - 1][1] <= hot) {
        ctx.moveTo(path[n - 1][0], path[n - 1][1])
        ctx.lineTo(path[n][0], path[n][1])
      }
    }
    ctx.stroke()
    ctx.lineWidth = 1
  }

  // the line itself
  ctx.fillStyle = ink(selected ? 0.6 : 0.32)
  if (right > left) ctx.fillRect(left, g.yB, right - left, 1)
  if (row.depth === 0 && x0 >= 0) ctx.fillRect(Math.round(x0), g.yB - 4, 1, 9)

  // each prompt is a bar line
  const barTop = g.compact ? g.yT - 1 : g.yT - 3
  let lastBar = -10
  ctx.fillStyle = ink(selected ? 0.3 : 0.14)
  for (const t of d.prompts) {
    if (t < env.from || t > env.to) continue
    const px = Math.round(xOf(env, t))
    if (px - lastBar < 3) continue
    ctx.fillRect(px, barTop, 1, g.bottom - barTop)
    lastBar = px
  }

  // tool calls: 5-minute buckets from far away, each call once there is room for it
  const bw = BUCKET * env.k
  const each = bw >= 7 && d.acts.length > 0
  const covered = each ? (s.activityTotal > d.acts.length ? d.acts[0].at : -Infinity) : Infinity
  const LH = [4, 3, 2, 3]
  const BASE = [0.42, 0.22, 0.13, 0.22]
  const GAIN = [0.58, 0.45, 0.33, 0.5]
  for (const b of d.buckets) {
    if (b.t + BUCKET < env.from || b.t > env.to || b.t + BUCKET > covered) continue
    const px = xOf(env, b.t)
    const w = Math.max(1, bw - 0.6)
    if (g.compact) {
      ctx.fillStyle = ink(0.2 + 0.7 * Math.min(1, b.total / 10))
      ctx.fillRect(px, g.lanes[0], w, 3)
      continue
    }
    for (let lane = 0; lane < 4; lane++) {
      if (!b.lanes[lane]) continue
      ctx.fillStyle = ink(BASE[lane] + GAIN[lane] * Math.min(1, b.lanes[lane] / 5))
      ctx.fillRect(px, g.lanes[lane], w, LH[lane])
    }
    if (b.mem && !d.asked) {
      ctx.strokeStyle = look.memory
      diamond(ctx, px + w / 2, g.yD, 3 * m, false)
    }
  }
  if (each) {
    const first = Math.max(0, lastAtOrBefore(d.acts, env.from - 10 * MIN, (a) => a.at))
    for (let n = first; n < d.acts.length && d.acts[n].at <= env.to; n++) act(ctx, env, g, d.acts[n], s.state === 'working' && n === d.acts.length - 1, !d.asked, m)
  }
  // a failed call is a signal at any distance
  ctx.strokeStyle = look.stalled
  ctx.lineWidth = 1.2
  for (const a of d.acts) {
    if (a.ok !== false || a.at < env.from || a.at > env.to) continue
    cross(ctx, xOf(env, a.at) + 1, (g.compact ? g.lanes[0] : g.lanes[Math.max(0, a.lane)]) + 1.5, 2.4 * m)
  }
  ctx.lineWidth = 1

  // memory, on the lane above the curve
  for (const mark of d.marks) {
    if (mark.t < env.from || mark.t > env.to) continue
    const px = xOf(env, mark.t)
    if (mark.type === 'injected') {
      ctx.globalAlpha = 0.3
      ctx.fillStyle = look.memory
      ctx.fillRect(Math.round(px), g.yD, 1, g.yB - g.yD)
      ctx.globalAlpha = 1
      diamond(ctx, px + 0.5, g.yD, (g.compact ? 2.8 : selected ? 4.4 : 3.6) * m, true)
    } else if (mark.type === 'asked') {
      ctx.strokeStyle = look.memory
      diamond(ctx, px + 0.5, g.yD, (g.compact ? 2.6 : 3.4) * m, false)
    } else if (mark.type === 'held') {
      if (g.compact && !each) continue
      ctx.globalAlpha = 0.5
      ctx.fillStyle = look.memory
      ring(ctx, px + 0.5, g.yD, 1.1, true)
      ctx.globalAlpha = 1
    } else if (!g.compact) {
      ctx.strokeStyle = ink(0.45)
      ctx.strokeRect(Math.round(px) - 1.5, Math.round(g.yD) - 2.5, 4, 4)
    }
  }

  // compactions: the cliff, marked
  for (const c of d.compactions) {
    if (c.at < env.from || c.at > env.to) continue
    const px = Math.round(xOf(env, c.at))
    ctx.fillStyle = ink(0.85)
    ctx.fillRect(px, yOf(c.pre), 1, Math.max(2, yOf(c.post) - yOf(c.pre)))
    ctx.beginPath()
    ctx.moveTo(px - 3, g.yT - 6)
    ctx.lineTo(px + 4, g.yT - 6)
    ctx.lineTo(px + 0.5, g.yT - 1.5)
    ctx.closePath()
    ctx.fill()
    if (!g.compact && bw >= 16) {
      ctx.font = face(look, 400, 10, 'mono')
      label(ctx, `${tokens(c.pre)} → ${tokens(c.post)}`, px + 7, g.yT + 6, ink(0.6))
      ctx.font = face(look, 400, 11.5, 'text')
    }
  }

  // what it saw and made
  if (!g.compact) {
    for (const sight of d.sights) {
      if (sight.t < env.from || sight.t > env.to) continue
      const px = xOf(env, sight.t)
      const y = g.lanes[3] + 1.5
      ctx.fillStyle = ink(1)
      ctx.strokeStyle = ink(0.9)
      if (sight.type === 'shot') ctx.fillRect(px - 2.5, y - 2.5, 5, 5)
      else if (sight.type === 'artifact') triangle(ctx, px, y, 3.4 * m, true)
      else if (!each) ring(ctx, px, y, 2.4, false)
    }
  }

  // from the last thing it did to now
  const hue = hueOf(look, s.state)
  if (xEnd > x1 + 1 && x1 < W) {
    const from = Math.max(x1, 0)
    if (s.state === 'working') {
      ctx.fillStyle = look.working
      ctx.globalAlpha = 0.75
      ctx.fillRect(from, g.yB, xEnd - from, 1)
      ctx.globalAlpha = 1
    } else {
      ctx.strokeStyle = waits ? hue : ink(0.3)
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(from, g.yB + 0.5)
      ctx.lineTo(xEnd, g.yB + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  if (!s.live && x1 >= 0 && x1 <= W) endMark(ctx, look, s, x1, g.yB, m)

  // its name, where the eye already is: in the empty time before it started
  const name = clip(s.title, 64)
  const width = ctx.measureText(name).width
  const colour = ink(selected ? 0.95 : 0.5)
  const startX = xOf(env, d.t0)
  if (startX - 10 - width >= 4 + row.depth * 10) {
    ctx.textAlign = 'right'
    label(ctx, name, startX - 9, g.yB + 0.5, colour)
    ctx.textAlign = 'left'
  } else if (!g.compact) label(ctx, name, Math.max(10, x0 + 8), box.y + 9 * m, colour)

  const pr = s.prs[0]
  if (pr && !s.live && x1 >= 0 && x1 < W - 60 && bw >= 3) {
    ctx.font = face(look, 400, 10, 'mono')
    label(ctx, '#' + pr.number, x1 + 9, g.yB - 8 * m, mergedOf(s) || s.state === 'ready' ? look.ready : ink(0.5))
  }
}

const hueOf = (look: Look, state: Session['state']): string =>
  state === 'need' ? look.need : state === 'working' ? look.working : state === 'ready' ? look.ready : state === 'stalled' ? look.stalled : ink(0.3)

/** How a line ends: a merged pull request, a pull request waiting, a stall, or just an end. */
function endMark(ctx: Ctx, look: Look, s: Session, px: number, y: number, m: number) {
  if (s.state === 'ready') {
    ctx.fillStyle = look.ready
    triangle(ctx, px, y, 4.5 * m, true)
  } else if (s.state === 'stalled') {
    ctx.strokeStyle = look.stalled
    ctx.lineWidth = 1.6
    cross(ctx, px, y, 4 * m)
    ctx.lineWidth = 1
  } else if (s.state === 'need') {
    ctx.fillStyle = look.need
    diamond(ctx, px, y, 4.5 * m, true)
  } else if (mergedOf(s)) {
    ctx.fillStyle = look.ready
    ring(ctx, px, y + 0.5, 2.2 * m, true)
    ctx.strokeStyle = look.ready
    ring(ctx, px, y + 0.5, 4.6 * m, false)
  } else {
    ctx.fillStyle = ink(0.6)
    ctx.fillRect(Math.round(px), y - 4, 1, 9)
  }
}

/** One tool call: its lane says what it did, its length how long it took. */
function act(ctx: Ctx, env: Env, g: Geom, a: Act, underWay: boolean, memoryHere: boolean, m: number) {
  const { look } = env
  const px = xOf(env, a.at)
  const w = Math.min(Math.max(0, (a.ms ?? 0) * env.k), 400)
  if (a.running && underWay) {
    ctx.fillStyle = look.working
    ctx.fillRect(px, g.compact ? g.lanes[0] : g.lanes[Math.max(0, a.lane)], Math.max(3, xOf(env, env.sc.now) - px), 3)
    return
  }
  if (g.compact) {
    ctx.fillStyle = ink([0.9, 0.5, 0.3, 0.6][Math.max(0, a.lane)])
    ctx.fillRect(px, g.lanes[0], Math.max(1.5, w), 3)
    return
  }
  if (a.lane < 0) {
    if (memoryHere) {
      ctx.strokeStyle = look.memory
      diamond(ctx, px, g.yD, 3 * m, false)
    }
    return
  }
  const y = g.lanes[a.lane]
  if (a.lane === 0) {
    ctx.fillStyle = ink(0.92)
    ctx.fillRect(px, y - 1, Math.max(2, w), 5)
    if (a.kind === 'write') ctx.fillRect(px, y - 3, 2, 1)
  } else if (a.lane === 1) {
    ctx.fillStyle = ink(0.5)
    ctx.fillRect(px, y, Math.max(2, w), 3)
  } else if (a.lane === 2) {
    ctx.fillStyle = ink(a.kind === 'search-code' ? 0.5 : 0.32)
    if (a.kind === 'search-code') ring(ctx, px + 1, y + 1, 1.3, true)
    else ctx.fillRect(px, y, Math.max(1.5, w), 2)
  } else {
    const cy = y + 1.5
    ctx.strokeStyle = ink(0.85)
    ctx.fillStyle = ink(0.85)
    if (a.kind === 'ask') {
      ctx.fillStyle = look.need
      diamond(ctx, px, cy, 3.4 * m, true)
    } else if (a.kind === 'browser') ctx.strokeRect(px - 2, cy - 2, 4, 4)
    else if (a.kind === 'agent') triangle(ctx, px, cy, 3 * m, false)
    else if (a.kind === 'web-fetch') {
      ring(ctx, px, cy, 2.6, false)
      ring(ctx, px, cy, 0.8, true)
    } else if (a.kind === 'web-search') ring(ctx, px, cy, 2.6, false)
    else {
      ctx.fillStyle = ink(0.5)
      ring(ctx, px, cy, 1.4, true)
    }
  }
}

/* ---- what is under the cursor ---- */

export type Hit =
  | { kind: 'act'; t: number; act: Act }
  | { kind: 'mark'; t: number; mark: Mark }
  | { kind: 'sight'; t: number; sight: Sight }
  | { kind: 'compaction'; t: number; pre: number; post: number; trigger: string | null }
  | { kind: 'prompt'; t: number }

/** The nearest thing within a few pixels of (px, py) on a session's row; `py` is in the
 *  scrolling content's coordinates. */
export function hit(env: Env, i: number, px: number, py: number): Hit | null {
  const row = env.rows[i]
  const box = env.boxes[i]
  if (!row || !box || row.type !== 'session') return null
  const d = env.sc.line(row.s)
  if (d.t0 == null) return null
  const g = geom(row, box)
  const t = tOf(env, px)
  const near = (time: number) => Math.abs(xOf(env, time) - px)
  let best: Hit | null = null
  let bestDist = Infinity
  const offer = (dist: number, what: Hit) => {
    if (dist <= 6 && dist < bestDist) {
      best = what
      bestDist = dist
    }
  }
  if (py <= g.yT + 2) for (const mark of d.marks) offer(near(mark.t), { kind: 'mark', t: mark.t, mark })
  for (const c of d.compactions) offer(near(c.at) + 1, { kind: 'compaction', t: c.at, pre: c.pre, post: c.post, trigger: c.trigger })
  if (py >= g.yB + 2) {
    const gap = g.compact ? 0 : g.lanes[1] - g.lanes[0]
    const lane = g.compact ? null : Math.max(0, Math.min(3, Math.round((py - g.lanes[0] - 1.5) / gap)))
    if (lane === 3) for (const sight of d.sights) offer(near(sight.t), { kind: 'sight', t: sight.t, sight })
    const last = lastAtOrBefore(d.acts, t + 6 / env.k, (a) => a.at)
    for (let n = last; n >= 0 && n > last - 40; n--) {
      const a = d.acts[n]
      // a mnemo call is drawn on the memory lane, not under the line
      if (lane != null && a.lane !== lane) continue
      const end = a.at + (a.ms ?? 0)
      offer(t >= a.at && t <= end ? 0 : Math.min(near(a.at), near(end)), { kind: 'act', t: a.at, act: a })
    }
  }
  if (!best && py > g.yT && py < g.yB) for (const p of d.prompts) offer(near(p) + 2, { kind: 'prompt', t: p })
  return best
}

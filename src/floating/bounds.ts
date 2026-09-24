// adapted from stablyai/orca src/renderer/src/components/floating-terminal/floating-terminal-panel-bounds.ts (MIT, 122b8c25)
// Where the floating terminal sits: pure, with the viewport passed in rather than read from `window`.

export const DEFAULT_PANEL_WIDTH = 920
export const DEFAULT_PANEL_HEIGHT = 560
export const MIN_PANEL_WIDTH = 420
export const MIN_PANEL_HEIGHT = 280
export const MAXIMIZED_MARGIN = 12
/** Above the status bar (h-6) with room to spare. */
export const MAXIMIZED_BOTTOM_GAP = 36
/** The panel may touch the titlebar (h-9) but never covers it. */
export const TITLEBAR_SAFE_TOP = 36
const DEFAULT_RIGHT_GAP = 24
const DEFAULT_BOTTOM_GAP = 84
const PANEL_EDGE_MARGIN = 8

export type Viewport = { width: number; height: number }
export type Bounds = { left: number; top: number; width: number; height: number }
/** Bounds kept relative to the nearest corner, so a panel parked bottom-right stays there when
 *  the window grows. This is what is remembered. */
export type AnchoredBounds = {
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), max)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function defaultBounds(vp: Viewport): Bounds {
  const width = Math.min(DEFAULT_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, vp.width - 48))
  const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, vp.height - 96))
  return {
    left: Math.max(16, vp.width - width - DEFAULT_RIGHT_GAP),
    top: Math.max(TITLEBAR_SAFE_TOP, vp.height - height - DEFAULT_BOTTOM_GAP),
    width,
    height,
  }
}

/** `b` kept on screen, below the titlebar and at least its minimum size. */
export function clampBounds(b: Bounds, vp: Viewport): Bounds {
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(b.width, Math.max(MIN_PANEL_WIDTH, vp.width - PANEL_EDGE_MARGIN * 2)))
  const height = Math.max(MIN_PANEL_HEIGHT, Math.min(b.height, Math.max(MIN_PANEL_HEIGHT, vp.height - TITLEBAR_SAFE_TOP - PANEL_EDGE_MARGIN)))
  const maxLeft = Math.max(PANEL_EDGE_MARGIN, vp.width - width - PANEL_EDGE_MARGIN)
  const maxTop = Math.max(TITLEBAR_SAFE_TOP, vp.height - height - PANEL_EDGE_MARGIN)
  return { left: clamp(b.left, PANEL_EDGE_MARGIN, maxLeft), top: clamp(b.top, TITLEBAR_SAFE_TOP, maxTop), width, height }
}

export function maximizedBounds(vp: Viewport): Bounds {
  return {
    left: MAXIMIZED_MARGIN,
    top: TITLEBAR_SAFE_TOP,
    width: Math.max(MIN_PANEL_WIDTH, vp.width - MAXIMIZED_MARGIN * 2),
    height: Math.max(MIN_PANEL_HEIGHT, vp.height - TITLEBAR_SAFE_TOP - MAXIMIZED_BOTTOM_GAP),
  }
}

/** `b` relative to its nearest corner; null in a window too small to hold the panel, where
 *  nothing should be remembered. */
export function anchorBounds(b: Bounds, vp: Viewport): AnchoredBounds | null {
  if (vp.width < MIN_PANEL_WIDTH + PANEL_EDGE_MARGIN * 2 || vp.height < MIN_PANEL_HEIGHT + TITLEBAR_SAFE_TOP + PANEL_EDGE_MARGIN) return null
  const anchorX = b.left + b.width / 2 <= vp.width / 2 ? 'left' : 'right'
  const anchorY = b.top + b.height / 2 <= vp.height / 2 ? 'top' : 'bottom'
  return {
    anchorX,
    anchorY,
    offsetX: anchorX === 'left' ? b.left : vp.width - b.left - b.width,
    offsetY: anchorY === 'top' ? b.top : vp.height - b.top - b.height,
    width: b.width,
    height: b.height,
  }
}

/** Remembered bounds placed in this viewport, clamped onto it. */
export function resolveBounds(a: AnchoredBounds, vp: Viewport): Bounds {
  return clampBounds(
    {
      left: a.anchorX === 'left' ? a.offsetX : vp.width - a.width - a.offsetX,
      top: a.anchorY === 'top' ? a.offsetY : vp.height - a.height - a.offsetY,
      width: a.width,
      height: a.height,
    },
    vp,
  )
}

export function parseAnchored(v: unknown): AnchoredBounds | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (r.anchorX !== 'left' && r.anchorX !== 'right') return null
  if (r.anchorY !== 'top' && r.anchorY !== 'bottom') return null
  if (!finite(r.offsetX) || !finite(r.offsetY) || !finite(r.width) || !finite(r.height)) return null
  return { anchorX: r.anchorX, anchorY: r.anchorY, offsetX: r.offsetX, offsetY: r.offsetY, width: r.width, height: r.height }
}

export type ResizeEdge = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'

/** `start` dragged by (dx, dy) on `edge`. A west or north edge stops at the minimum size rather
 *  than pushing the opposite edge along. */
export function resizeBounds(start: Bounds, edge: ResizeEdge, dx: number, dy: number): Bounds {
  const next = { ...start }
  if (edge.includes('e')) next.width = start.width + dx
  if (edge.includes('s')) next.height = start.height + dy
  if (edge.includes('w')) {
    next.left = start.left + dx
    next.width = start.width - dx
  }
  if (edge.includes('n')) {
    next.top = start.top + dy
    next.height = start.height - dy
  }
  if (next.width < MIN_PANEL_WIDTH && edge.includes('w')) next.left = start.left + start.width - MIN_PANEL_WIDTH
  if (next.height < MIN_PANEL_HEIGHT && edge.includes('n')) next.top = start.top + start.height - MIN_PANEL_HEIGHT
  return next
}

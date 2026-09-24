import {
  anchorBounds,
  clampBounds,
  defaultBounds,
  maximizedBounds,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  parseAnchored,
  resizeBounds,
  resolveBounds,
  TITLEBAR_SAFE_TOP,
} from './bounds'

const vp = { width: 1440, height: 900 }

describe('the floating panel bounds', () => {
  it('opens bottom-right at 920×560 by default, and shrinks to a small window', () => {
    expect(defaultBounds(vp)).toEqual({ left: 1440 - 920 - 24, top: 900 - 560 - 84, width: 920, height: 560 })
    const small = defaultBounds({ width: 500, height: 400 })
    expect(small.width).toBe(452)
    expect(small.height).toBe(304)
    expect(defaultBounds({ width: 500, height: 300 }).height).toBe(MIN_PANEL_HEIGHT)
    expect(small.top).toBeGreaterThanOrEqual(TITLEBAR_SAFE_TOP)
  })

  it('keeps the panel on screen, below the titlebar, at least its minimum size', () => {
    expect(clampBounds({ left: -200, top: 0, width: 100, height: 50 }, vp)).toEqual({ left: 8, top: TITLEBAR_SAFE_TOP, width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT })
    expect(clampBounds({ left: 5000, top: 5000, width: 600, height: 400 }, vp)).toEqual({ left: 1440 - 600 - 8, top: 900 - 400 - 8, width: 600, height: 400 })
    expect(clampBounds({ left: 0, top: 0, width: 9999, height: 9999 }, vp)).toEqual({ left: 8, top: TITLEBAR_SAFE_TOP, width: 1440 - 16, height: 900 - TITLEBAR_SAFE_TOP - 8 })
  })

  it('fills the window under the titlebar when maximized', () => {
    expect(maximizedBounds(vp)).toEqual({ left: 12, top: TITLEBAR_SAFE_TOP, width: 1440 - 24, height: 900 - TITLEBAR_SAFE_TOP - 36 })
  })

  it('remembers a panel by its nearest corner, so it keeps that corner when the window grows', () => {
    const b = { left: 900, top: 500, width: 500, height: 300 }
    const a = anchorBounds(b, vp)!
    expect(a).toEqual({ anchorX: 'right', anchorY: 'bottom', offsetX: 40, offsetY: 100, width: 500, height: 300 })
    expect(resolveBounds(a, vp)).toEqual(b)
    expect(resolveBounds(a, { width: 1920, height: 1080 })).toEqual({ left: 1920 - 500 - 40, top: 1080 - 300 - 100, width: 500, height: 300 })
    const topLeft = anchorBounds({ left: 20, top: 50, width: 500, height: 300 }, vp)!
    expect([topLeft.anchorX, topLeft.anchorY, topLeft.offsetX, topLeft.offsetY]).toEqual(['left', 'top', 20, 50])
    // A window too small to hold the panel remembers nothing.
    expect(anchorBounds(b, { width: 300, height: 200 })).toBeNull()
  })

  it('reads remembered bounds back only when whole', () => {
    const a = { anchorX: 'left', anchorY: 'bottom', offsetX: 1, offsetY: 2, width: 500, height: 300 }
    expect(parseAnchored(a)).toEqual(a)
    expect(parseAnchored({ ...a, anchorX: 'middle' })).toBeNull()
    expect(parseAnchored({ ...a, width: Number.NaN })).toBeNull()
    expect(parseAnchored([a])).toBeNull()
    expect(parseAnchored(null)).toBeNull()
  })

  it('resizes from each edge; a west or north edge stops at the minimum instead of pushing', () => {
    const b = { left: 100, top: 100, width: 600, height: 400 }
    expect(resizeBounds(b, 'se', 50, 20)).toEqual({ left: 100, top: 100, width: 650, height: 420 })
    expect(resizeBounds(b, 'nw', -30, -10)).toEqual({ left: 70, top: 90, width: 630, height: 410 })
    expect(resizeBounds(b, 'w', 500, 0)).toEqual({ left: 100 + 600 - MIN_PANEL_WIDTH, top: 100, width: 100, height: 400 })
    expect(resizeBounds(b, 'n', 0, 300)).toEqual({ left: 100, top: 100 + 400 - MIN_PANEL_HEIGHT, width: 600, height: 100 })
    expect(resizeBounds(b, 'e', 0, 99)).toEqual({ ...b })
  })
})

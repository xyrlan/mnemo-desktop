/** The drawer's width, remembered per machine. Storage may be missing or refuse (a private
 *  window, blocked site data): the width is then the default each launch. */

export const WIDTH_KEY = 'mnemo.nexus.drawer-width.v1'
/** The narrowest drawer, and the least the ship keeps beside it. */
export const MIN_WIDTH = 380
export const MIN_SHIP = 560

const viewport = () => (typeof window === 'undefined' ? 1440 : window.innerWidth)

/** `w` kept between `MIN_WIDTH` and what leaves the ship `MIN_SHIP`. */
export function clampWidth(w: number, vw = viewport()): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(vw - MIN_SHIP, w)))
}

export const defaultWidth = (vw = viewport()) => clampWidth(Math.min(720, vw * 0.42), vw)

export function readWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    return raw > 0 ? clampWidth(raw) : defaultWidth()
  } catch {
    return defaultWidth()
  }
}

export function saveWidth(w: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)))
  } catch {
    // Not remembered: the default comes back next launch.
  }
}

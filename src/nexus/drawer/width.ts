/** The drawer's width, remembered per machine once dragged. Storage may be missing or refuse (a
 *  private window, blocked site data): the width is then the default each launch.
 *
 *  Until one is dragged the width is the default, measured against the window as it is each time
 *  it is drawn: worked out once at load, it kept the window the app opened at (1280 wide), and a
 *  window made larger after showed the drawer narrower than the default. */

export const WIDTH_KEY = 'mnemo.nexus.drawer-width.v1'
/** The narrowest drawer, and the least the ship keeps beside it. */
export const MIN_WIDTH = 380
export const MIN_SHIP = 560
/** The default: 42% of the window, at most 720 px, as in the approved prototype
 *  (`docs/superpowers/prototypes/nexus-v2/index.html`, `DW`). */
export const DEFAULT_SHARE = 0.42
export const DEFAULT_MAX = 720

const viewport = () => (typeof window === 'undefined' ? 1440 : window.innerWidth)

/** `w` kept between `MIN_WIDTH` and what leaves the ship `MIN_SHIP`. */
export function clampWidth(w: number, vw = viewport()): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(vw - MIN_SHIP, w)))
}

export const defaultWidth = (vw = viewport()) => clampWidth(Math.min(DEFAULT_MAX, vw * DEFAULT_SHARE), vw)

/** The width as drawn in a window `vw` wide: the one dragged and saved, else the default. */
export const shownWidth = (chosen: number | null, vw = viewport()) => (chosen === null ? defaultWidth(vw) : clampWidth(chosen, vw))

/** The width dragged and saved, or null for the default. It is kept as saved, and fitted to the
 *  window only as it is drawn. */
export function readWidth(): number | null {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    return raw > 0 ? Math.round(raw) : null
  } catch {
    return null
  }
}

export function saveWidth(w: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)))
  } catch {
    // Not remembered: the default comes back next launch.
  }
}

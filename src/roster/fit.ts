// Every parent stays on screen: the roster is drawn at up to four densities and takes the
// first that fits its height, then hands the room left over back to the entries highest in the
// list. The deciding is here, apart from the measuring, so it can be tested without a layout.

import type { Density } from './model'

/** What one drawing of the list measured. */
export interface Measured {
  /** The list is no taller than the room it has. */
  fits: boolean
  /** The room left under the list, in px; negative when it does not fit. */
  free: number
  /** The height of each root's entry that is drawn whole (not folded), by id, in list order. */
  heights: ReadonlyMap<string, number>
}

export interface Fit {
  density: Density
  /** Roots given their third row back. */
  roomy: ReadonlySet<string>
  /** measure: draw at `density` and measure. roomy: draw with `roomy` and check it still
   *  fits. done: this is the drawing to keep. */
  pass: 'measure' | 'roomy' | 'done'
  /** Not even the tightest drawing fits: the list scrolls. */
  over: boolean
  /** What the loosest drawing measured, to know what a tight entry would grow back to. */
  loose: ReadonlyMap<string, number> | null
}

const NONE: ReadonlySet<string> = new Set()

/** Where every fitting starts: as designed. A new object each time, so starting again is a
 *  change even from the start. */
export const startFit = (): Fit => ({ density: 0, roomy: NONE, pass: 'measure', over: false, loose: null })

/** What to draw next, given what the current drawing measured. */
export function fitStep(fit: Fit, m: Measured): Fit {
  if (fit.pass === 'done') return fit
  if (fit.pass === 'roomy') return m.fits ? { ...fit, pass: 'done' } : { ...fit, roomy: NONE, pass: 'done' }
  const loose = fit.loose ?? m.heights
  if (!m.fits && fit.density < 3) return { ...fit, density: (fit.density + 1) as Density, loose }
  if (fit.density > 0) {
    // a drawing that does not fit has no room to hand out: `free` is negative
    let free = m.free
    const roomy = new Set<string>()
    for (const [id, height] of m.heights) {
      const more = (loose.get(id) ?? height) - height
      if (more > 0 && more <= free) {
        roomy.add(id)
        free -= more
      }
    }
    if (roomy.size) return { ...fit, loose, roomy, pass: 'roomy' }
  }
  return { ...fit, loose, pass: 'done', over: !m.fits }
}

/** The fitting, start to end, over something that can draw and measure at once. */
export function settle(measure: (density: Density, roomy: ReadonlySet<string>) => Measured): Fit {
  let fit = startFit()
  // four densities and one roomy pass at most; the bound is against a `measure` that lies
  for (let i = 0; i < 8 && fit.pass !== 'done'; i++) fit = fitStep(fit, measure(fit.density, fit.roomy))
  return fit
}

/** Where a list scrolled to `scrollTop`, with `room` px showing, must be scrolled so that
 *  `top`..`bottom` is in sight with `pad` around it. The top wins when both cannot be. */
export function reveal(top: number, bottom: number, scrollTop: number, room: number, pad: number): number {
  let at = scrollTop
  if (bottom + pad > at + room) at = bottom + pad - room
  if (top - pad < at) at = Math.max(0, top - pad)
  return at
}

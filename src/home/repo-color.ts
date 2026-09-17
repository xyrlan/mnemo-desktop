/** Hues a repo's accent is picked from: evenly spaced, so two accents differ by at least
 *  `360 / HUES` degrees or are the same colour. */
export const HUES = 10
const OFFSET = 15

/** FNV-1a, 32 bits: stable across runs and machines, which `Math.random` or a Map order is not. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The hue (degrees) of a repo's accent. A trailing slash names the same repo. */
export function accentHue(root: string): number {
  return OFFSET + (fnv1a(root.replace(/\/+$/, '')) % HUES) * (360 / HUES)
}

/** A repo's accent colour, derived from its path alone: same path, same colour, with nothing
 *  stored. Takes the lightness and chroma of the theme's `--accent` and only turns the hue, so
 *  whatever theme defines `--accent` for its background, every repo accent reads against it too. */
export function repoAccent(root: string): string {
  return `oklch(from var(--accent) l c ${accentHue(root)})`
}

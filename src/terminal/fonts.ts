/** Web fonts and the terminal's kept glyphs (#315).
 *
 *  The WebGL renderer draws each glyph once into a texture and keeps it. JetBrains Mono is a web
 *  font: one file per weight and unicode range, fetched when first used. A glyph drawn while its
 *  face is still on the way is drawn in the fallback font, and kept, beside the glyphs first
 *  drawn after the face arrived. On Windows, where the fallback looks nothing like it, bold
 *  words came out in two typefaces. So a terminal asks for its faces when it opens, and whenever
 *  one arrives it measures its cells and draws every glyph again. */
import type { Terminal } from '@xterm/xterm'

/** The weights a terminal draws with: the ones theme.css imports. */
export const WEIGHTS = [400, 700] as const

type Fonts = Pick<FontFaceSet, 'load' | 'addEventListener' | 'removeEventListener'>

/** The page's fonts; undefined where there are none (a test's DOM). */
const pageFonts = (): Fonts | undefined => (typeof document === 'undefined' ? undefined : document.fonts)

/** The names in a CSS `font-family` list, unquoted and lowercased. */
export function families(list: string): string[] {
  return list
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean)
}

/** Asks for every weight of `family` at `size`. Settles when each has loaded or failed: a face
 *  that cannot be fetched leaves the fallback, which is all there is to draw with. */
export function loadFaces(family: string, size: number, fonts: Fonts | undefined = pageFonts()): Promise<void> {
  if (!fonts) return Promise.resolve()
  return Promise.allSettled(WEIGHTS.map((weight) => fonts.load(`${weight} ${size}px ${family}`))).then(() => undefined)
}

/** Calls `arrived` whenever a face of one of `family`'s fonts finishes loading, the ones nobody
 *  asked for up front included (a unicode range first used an hour in). Returns how to stop. */
export function onFaces(family: string, arrived: () => void, fonts: Fonts | undefined = pageFonts()): () => void {
  if (!fonts) return () => {}
  const mine = new Set(families(family))
  const done = (e: Event) => {
    const faces = (e as FontFaceSetLoadEvent).fontfaces ?? []
    if (faces.some((face) => families(face.family).some((name) => mine.has(name)))) arrived()
  }
  fonts.addEventListener('loadingdone', done)
  return () => fonts.removeEventListener('loadingdone', done)
}

/** Makes `term` measure its cells and draw every glyph again, in the fonts as they are now. */
export function redraw(term: Pick<Terminal, 'options' | 'clearTextureAtlas'>): void {
  // xterm measures a cell when the family changes and at no other time, so it is changed and
  // put back. That brings the same texture back, glyphs and all, which is why it is cleared.
  const family = term.options.fontFamily
  term.options.fontFamily = 'monospace'
  term.options.fontFamily = family
  term.clearTextureAtlas()
}

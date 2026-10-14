import { WEIGHTS, families, loadFaces, onFaces, redraw, track } from './fonts'

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace"

/** A FontFaceSet as far as fonts.ts uses one: `load` recorded, `loadingdone` dispatched by hand. */
function fakeFonts(load: (font: string) => Promise<FontFace[]> = () => Promise.resolve([])) {
  const target = new EventTarget()
  const asked: string[] = []
  return {
    asked,
    load: (font: string) => {
      asked.push(font)
      return load(font)
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    /** A face of each of these families finished loading. */
    arrive(...names: string[]) {
      const e = new Event('loadingdone')
      Object.assign(e, { fontfaces: names.map((family) => ({ family })) })
      target.dispatchEvent(e)
    },
  }
}

/** theme.css as it is on disk: the test runner hands a stylesheet import back empty. The path is
 *  a variable so Vite leaves `new URL` alone, and the modules are named in pieces so it does not
 *  try to bundle them (as src/conversation/parse.test.ts does). */
async function themeCss(rel = '../theme.css'): Promise<string> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as { readFileSync(path: string, encoding: string): string }
  const url = (await import(/* @vite-ignore */ 'node:' + 'url')) as unknown as { fileURLToPath(url: URL): string }
  return fs.readFileSync(url.fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

test('the weights asked for are the ones theme.css bundles', async () => {
  const bundled = [...(await themeCss()).matchAll(/@import '@fontsource\/jetbrains-mono\/(\d+)\.css'/g)].map((m) => Number(m[1]))
  expect(bundled).toEqual([...WEIGHTS])
})

test('a font-family list is read name by name, whatever the quotes and the case', () => {
  expect(families(MONO)).toEqual(['jetbrains mono', 'ui-monospace', 'menlo', 'monospace'])
  expect(families('"JetBrains Mono"')).toEqual(['jetbrains mono'])
  expect(families('')).toEqual([])
})

test('opening asks for the regular and the bold face of the whole family list', async () => {
  const fonts = fakeFonts()
  await loadFaces(MONO, 13, fonts)
  expect(fonts.asked).toEqual([`400 13px ${MONO}`, `700 13px ${MONO}`])
})

test('a face that cannot be fetched does not hold the terminal back', async () => {
  const fonts = fakeFonts((font) => (font.startsWith('700') ? Promise.reject(new Error('offline')) : Promise.resolve([])))
  await expect(loadFaces(MONO, 13, fonts)).resolves.toBeUndefined()
  expect(fonts.asked).toHaveLength(2)
  // No FontFaceSet at all, as in a test's DOM.
  await expect(loadFaces(MONO, 13, undefined)).resolves.toBeUndefined()
})

test('a face of the terminal’s font arriving is told, and only of that font', () => {
  const fonts = fakeFonts()
  let arrived = 0
  const stop = onFaces(MONO, () => arrived++, fonts)
  fonts.arrive('Geist Variable')
  expect(arrived).toBe(0)
  // Chromium reports a CSS face's family as written, quotes and all.
  fonts.arrive('"JetBrains Mono"')
  expect(arrived).toBe(1)
  fonts.arrive('Geist Variable', 'JetBrains Mono')
  expect(arrived).toBe(2)
  stop()
  fonts.arrive('JetBrains Mono')
  expect(arrived).toBe(2)
  expect(onFaces(MONO, () => arrived++, undefined)).toBeTypeOf('function')
})

test('redrawing measures again and then drops the kept glyphs, leaving the family as it was', () => {
  const steps: string[] = []
  let family: string | undefined = MONO
  const term = {
    options: {
      get fontFamily() {
        return family
      },
      set fontFamily(next: string | undefined) {
        steps.push(`family: ${next}`)
        family = next
      },
    },
    clearTextureAtlas: () => steps.push('glyphs dropped'),
  }
  redraw(term)
  // The change is what makes xterm measure; clearing comes last, or the wrong glyphs come back.
  expect(steps).toEqual(['family: monospace', `family: ${MONO}`, 'glyphs dropped'])
  expect(term.options.fontFamily).toBe(MONO)
})

test('one terminal dropping the shared glyphs makes every open one forget them (#393)', () => {
  const dropped: string[] = []
  const terminal = (name: string) => ({
    options: { fontFamily: MONO },
    clearTextureAtlas: () => dropped.push(name),
  })
  const [a, b, c, closed] = ['a', 'b', 'c', 'closed'].map(terminal)
  const untrack = [a, b, c, closed].map(track)
  untrack[3]()
  redraw(c)
  // c clears first, while it is the one whose cells are measured again; the rest only forget.
  expect(dropped).toEqual(['c', 'a', 'b'])
  untrack.forEach((u) => u())
  dropped.length = 0
  redraw(a)
  expect(dropped).toEqual(['a'])
})

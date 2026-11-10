// The sources are read off disk the way src/path/guard.test.ts reads them: `tsc` checks tests with
// the app's types (no Node modules).
import { expect, test } from 'vitest'

/** The overlays wear the new identity (docs/superpowers/specs/2026-11-10-recreation-front.md,
 *  "The overlays"): James's panel and orb, the notification stack and dictation's indicator.
 *  None of them takes the ship's stylesheet or its kit any more, and each is a root of the new
 *  identity of its own, since it is drawn outside the frame's. */

type Fs = { readFileSync(path: string, encoding: string): string; readdirSync(path: string): string[]; statSync(path: string): { isDirectory(): boolean } }
const fs = async () => (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs

/** Every file under `path`, repo-relative. */
async function files(path: string): Promise<string[]> {
  const { readdirSync, statSync } = await fs()
  if (!statSync(path).isDirectory()) return [path]
  return (await Promise.all(readdirSync(path).map((name) => files(`${path}/${name}`)))).flat()
}

/** What the overlays are made of: the piece's own files, tests aside. */
const OVERLAYS = ['src/jarvis/panel', 'src/jarvis/orb', 'src/jarvis/view.tsx', 'src/notify', 'src/voice/Indicator.tsx', 'src/voice/FileWork.tsx', 'src/voice/Grapes.tsx', 'src/voice/view.tsx', 'src/voice/voice.css', 'orb.html']

async function sources(): Promise<{ file: string; text: string }[]> {
  const { readFileSync } = await fs()
  const all = (await Promise.all(OVERLAYS.map(files))).flat().filter((f) => /\.(tsx?|css|html)$/.test(f) && !/\.test\.tsx?$/.test(f))
  return all.map((file) => ({ file, text: readFileSync(file, 'utf8') }))
}

/** What a source imports: `import … from 'x'`, `import 'x'`, and a sheet's `@import`. */
const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import\s+(?:[^'"]*?\s+from\s+)?|@import\s+(?:url\()?)['"]([^'"]+)['"]/g)].map((m) => m[1])

test('the overlays are found where they are said to be', async () => {
  const found = (await sources()).map((s) => s.file)
  for (const file of ['src/jarvis/panel/Panel.tsx', 'src/jarvis/panel/panel.css', 'src/jarvis/orb/main.ts', 'src/notify/NotificationStack.tsx', 'src/notify/notify.css', 'src/voice/Indicator.tsx', 'src/voice/voice.css', 'orb.html']) expect(found).toContain(file)
})

test("none of the overlays imports the ship's stylesheet", async () => {
  const taking = (await sources()).filter((s) => imports(s.text).some((spec) => /nexus\/ui\/ui\.css$/.test(spec))).map((s) => s.file)
  expect(taking).toEqual([])
})

test("none of the overlays draws with the ship's kit or the workbench's components", async () => {
  for (const { file, text } of await sources()) {
    if (!/\.tsx$/.test(file)) continue
    // The ship's kit is `nx-…` classes; the workbench's is `@/ui`.
    expect(text.match(/className="[^"]*\bnx(?:-[a-z-]+)?\b[^"]*"/g) ?? [], file).toEqual([])
    expect(imports(text).filter((spec) => spec === '@/ui' || spec.startsWith('@/ui/')), file).toEqual([])
  }
})

test("the overlays' sheets read the identity's tokens, and none of the ship's", async () => {
  const sheets = (await sources()).filter((s) => s.file.endsWith('.css'))
  expect(sheets.map((s) => s.file).sort()).toEqual(['src/jarvis/panel/panel.css', 'src/notify/notify.css', 'src/voice/voice.css'])
  for (const { file, text } of sheets) {
    expect(text.match(/var\(--nx-[a-z0-9-]+/g) ?? [], file).toEqual([])
    expect(text, file).toMatch(/var\(--(ink|line|void)/)
    // Every rule is under the identity's root: a sheet loaded under the ship styles nothing of it.
    const selectors = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .split('}')
      .map((rule) => rule.split('{')[0].trim())
      .filter((selector) => selector && !selector.startsWith('@'))
      .flatMap((selector) => selector.split(','))
      .map((selector) => selector.trim())
    expect(selectors.length, file).toBeGreaterThan(10)
    expect(selectors.filter((selector) => !/\.mn\b/.test(selector)), file).toEqual([])
  }
})

test('motion in the overlays is transform and opacity, and every animation has its stilled rule', async () => {
  for (const { file, text } of (await sources()).filter((s) => s.file.endsWith('.css'))) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
    const frames = [...css.matchAll(/@keyframes\s+([a-z-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)]
    for (const [, name, body] of frames) {
      const moved = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
      expect(moved.filter((property) => property !== 'transform' && property !== 'opacity'), `${file} ${name}`).toEqual([])
    }
    // An animation of the sheet's own is stilled by the system and by the frame's switch.
    if (frames.length === 0) continue
    expect(css, file).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*animation: none/)
    expect(css, file).toMatch(/\.mn\[data-motion='reduced'\][^{]*\{[^}]*animation: none/)
  }
})

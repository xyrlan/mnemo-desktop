// The sources read off disk the way parse.test.ts reads its fixtures: `tsc` checks tests with the
// app's types (no Node modules).
import { expect, test } from 'vitest'

type Fs = {
  readdirSync(path: string, opts: { recursive: true }): string[]
  readFileSync(path: string, encoding: string): string
}

/** Files that still trim a trailing `/` themselves. None compares paths in the places #355 is
 *  about; each is its own area's to move onto `src/path/path.ts`. Do not add to this list: use
 *  `norm` (or `basename`, `within`, `samePath`) from there. */
const TRIMS_ITS_OWN = new Set([
  'src/chat-input/catalog.ts',
  'src/diff/DiffPane.tsx',
  'src/editor/client.ts',
  'src/explorer/git.ts',
  'src/home/repo-color.ts',
  'src/home/types.ts',
  'src/source-control/model.ts',
])

async function sources(): Promise<[string, string][]> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  return fs
    .readdirSync('src', { recursive: true })
    .map((f) => `src/${f.replace(/\\/g, '/')}`)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'src/path/path.ts')
    .map((f) => [f, fs.readFileSync(f, 'utf8')])
}

test('no private path `norm` grows outside src/path/path.ts (#355)', async () => {
  const found: string[] = []
  for (const [file, text] of await sources()) {
    // A `norm` of something else (`conversation/outbox.ts` squeezes whitespace) says nothing of `/`.
    if (/\b(?:const|let|function)\s+(?:norm|trimSlash)\b.*(?:\\\/|'\/')/.test(text)) found.push(`${file}: defines its own norm`)
    if (text.includes(".replace(/\\/+$/, '')") && !TRIMS_ITS_OWN.has(file)) found.push(`${file}: trims a trailing / itself`)
  }
  expect(found).toEqual([])
})

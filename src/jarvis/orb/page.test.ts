// The sources read off disk the way src/path/guard.test.ts reads them: `tsc` checks tests with the
// app's types (no Node modules).
import { expect, test } from 'vitest'

/** The orb's page loads none of the app (#506): `orb.html`'s script, and everything it imports,
 *  stays inside `src/jarvis/orb/` but for Tauri's own API. A type-only import costs nothing at run
 *  time, so it may reach further. */

type Fs = { readFileSync(path: string, encoding: string): string }
const read = async (path: string) => ((await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs).readFileSync(path, 'utf8')

/** The modules `src` loads when it runs: its imports that are not `import type`. */
function runtimeImports(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/^\s*import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    if (!m[1]) out.push(m[2])
  }
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)|import\.meta\.glob/g)) out.push(m[1] ?? 'import.meta.glob')
  return out
}

/** `spec` from the file `from`, both repo-relative. */
function join(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const p of spec.split('/')) {
    if (p === '..') parts.pop()
    else if (p !== '.') parts.push(p)
  }
  const file = parts.join('/')
  return file.endsWith('.ts') ? file : `${file}.ts`
}

async function graph(entry: string): Promise<{ files: string[]; packages: string[] }> {
  const files: string[] = []
  const packages = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (files.includes(f)) continue
    files.push(f)
    for (const spec of runtimeImports(await read(f))) {
      if (spec.startsWith('.')) stack.push(join(f, spec))
      else packages.add(spec)
    }
  }
  return { files, packages: [...packages] }
}

test('orb.html runs its own entry, and no other script', async () => {
  const html = await read('orb.html')
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1])
  expect(scripts).toEqual(['/src/jarvis/orb/main.ts'])
  expect(html).not.toMatch(/<link[^>]+stylesheet/)
})

test('the orb’s page loads nothing from the app’s views, terminals or stores', async () => {
  const { files, packages } = await graph('src/jarvis/orb/main.ts')
  expect(files.every((f) => f.startsWith('src/jarvis/orb/')), files.join(', ')).toBe(true)
  expect(files).not.toContain('src/jarvis/orb/control.ts')
  expect(packages).toEqual(['@tauri-apps/api/event'])
})

test('the build makes orb.html an entry beside index.html', async () => {
  const vite = await read('vite.config.ts')
  expect(vite).toMatch(/orb:\s*fileURLToPath\(new URL\('\.\/orb\.html'/)
  expect(vite).toMatch(/main:\s*fileURLToPath\(new URL\('\.\/index\.html'/)
})

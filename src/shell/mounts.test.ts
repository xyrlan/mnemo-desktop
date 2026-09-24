// App.tsx imports `src/<dir>/view.tsx` and nothing else, so a screen that mounts itself in a
// shell slot from any other file never runs. The status bar's mount lived in `index.ts` and the
// bar was never drawn; every CI check passed.
const sources = import.meta.glob<string>('../*/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// Vite spells this folder's own files `./x.ts`, every other folder's `../dir/x.ts`.
const dirOf = (path: string) => (path.startsWith('./') ? 'shell' : path.split('/')[1])
const views = new Set(Object.keys(import.meta.glob('../*/view.tsx')).map(dirOf))

test('every folder that mounts a screen in a shell slot has a view.tsx for App to import', () => {
  const mounting = new Set<string>()
  for (const [path, src] of Object.entries(sources)) {
    const dir = dirOf(path)
    if (dir === 'shell' || /\.test\.tsx?$/.test(path)) continue
    if (/mountInSlot\??\.?\(\s*['"]/.test(src)) mounting.add(dir)
  }
  expect(mounting.size).toBeGreaterThan(5)
  expect([...mounting].filter((d) => !views.has(d)).sort()).toEqual([])
})

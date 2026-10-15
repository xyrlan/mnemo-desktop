import libRs from '../../src-tauri/src/lib.rs?raw'
import pkg from '../../package.json'

const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

test('the map is gone: no sigma or graphology import, no vaultmap in Rust', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50)
  expect(Object.keys(sources).filter((f) => /from ['"](sigma|@sigma\/|graphology)/.test(sources[f]))).toEqual([])
  expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /sigma|graphology/.test(d))).toEqual([])
  expect(libRs).not.toMatch(/vaultmap|vault_map/)
})

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import libRs from '../../src-tauri/src/lib.rs?raw'
import pkg from '../../package.json'

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => (cmd === 'vault_rules' || cmd === 'vault_tree' ? [] : cmd === 'vault_run' ? { stdout: '', stderr: '', code: 0 } : undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

test('the vault pane offers Health and Pages, and no map action', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const { all } = await import('../actions/registry')
  expect(all().some((a) => a.id === 'vault.map')).toBe(false)
  const Pane = paneView('vault')!

  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(<Pane id={-1} props={{}} />))
  expect([...host.querySelectorAll('.vt-modes button')].map((b) => b.textContent)).toEqual(['Health', 'Pages'])
  await act(async () => r.unmount())
})

test('the map is gone: no sigma or graphology import, no vaultmap in Rust', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50)
  expect(Object.keys(sources).filter((f) => /from ['"](sigma|@sigma\/|graphology)/.test(sources[f]))).toEqual([])
  expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /sigma|graphology/.test(d))).toEqual([])
  expect(libRs).not.toMatch(/vaultmap|vault_map/)
})

import { act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => (cmd === 'vault_rules' || cmd === 'vault_tree' ? [] : cmd === 'vault_run' ? { stdout: '', stderr: '', code: 0 } : undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The map itself needs WebGL; the tab only has to mount it.
vi.mock('./MapPane', () => ({ default: ({ current }: { current?: string }) => <div className="fake-map">map of {current ?? 'everyone'}</div> }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('.vt-modes button')].find((b) => b.textContent === text) as HTMLElement

test('Mapa sits beside Health and Pages, mounts the map, and the palette opens it', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('../view')
  const { paneView } = await import('../../panes/registry')
  const { all } = await import('../../actions/registry')
  const { mapStore } = await import('./store')
  const Pane = paneView('vault')!

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  expect([...host.querySelectorAll('.vt-modes button')].map((b) => b.textContent)).toEqual(['Health', 'Pages', 'Mapa'])
  // Health stays the default screen.
  expect(host.querySelector('.vr')).toBeTruthy()
  expect(host.querySelector('.fake-map')).toBeNull()

  await act(async () => button(host, 'Mapa').click())
  await flush()
  expect(host.querySelector('.fake-map')).toBeTruthy()
  expect(host.querySelector('.vr')).toBeNull()
  expect(button(host, 'Mapa').className).toBe('vt-mode-on')
  expect(button(host, 'Health').className).toBe('')

  await act(async () => button(host, 'Health').click())
  expect(host.querySelector('.fake-map')).toBeNull()
  expect(host.querySelector('.vr')).toBeTruthy()

  await act(async () => all().find((a) => a.id === 'vault.map')!.run())
  await flush()
  expect(mapStore.getState().open).toBe(true)
  expect(host.querySelector('.fake-map')).toBeTruthy()
  await act(async () => all().find((a) => a.id === 'vault.pages')!.run())
  expect(mapStore.getState().open).toBe(false)

  await act(async () => root.unmount())
})

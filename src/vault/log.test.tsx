import { act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => {
    if (cmd === 'vault_run') return { stdout: 'ok', stderr: '', code: 0 }
    if (cmd === 'vault_rules' || cmd === 'vault_tree') return []
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

test('the run log survives a scrollIntoView that returns a promise, as Chromium’s does', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const scroll = Element.prototype.scrollIntoView
  // Returned from an effect, a promise is called as its cleanup: "destroy is not a function".
  Element.prototype.scrollIntoView = () => Promise.resolve() as unknown as void
  try {
    await import('./view')
    const { vault } = await import('./app-store')
    const { paneView } = await import('../panes/registry')
    const Pane = paneView('vault')!
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Pane id={-1} props={{}} />))
    await flush()

    await act(() => vault.getState().run('status', ''))
    await act(() => vault.getState().run('learn', ''))
    await flush()
    expect([...host.querySelectorAll('.vt-log-line')].map((e) => e.textContent)).toEqual(['$ mnemo status', '$ mnemo learn'])

    await act(async () => (host.querySelector('.vt-log-entry button[title="Dismiss"]') as HTMLElement).click())
    expect([...host.querySelectorAll('.vt-log-line')].map((e) => e.textContent)).toEqual(['$ mnemo learn'])
    await act(async () => root.unmount())
    host.remove()
  } finally {
    Element.prototype.scrollIntoView = scroll
  }
})

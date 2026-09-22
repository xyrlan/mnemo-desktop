import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Agent } from './types'

const dir = '/v/bots/mnemo-desktop/memory'
const info = {
  path: `${dir}/gone.md`,
  slug: 'gone',
  name: 'gone',
  description: 'a page deleted under the tree',
  type: 'project',
  confidence: 'observed',
  topics: [],
  modified: null,
  body: '',
}
const tree: Agent[] = [{ name: 'mnemo-desktop', kind: 'repo', dir, groups: [{ type: 'project', pages: [info] }] }]
let treeFails = true

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string) => {
    if (cmd === 'vault_tree') {
      if (treeFails) throw new Error('mnemo status: no vault')
      return tree
    }
    if (cmd === 'vault_page') throw new Error('ENOENT: gone.md')
    if (cmd === 'vault_run') return { stdout: '', stderr: '', code: 0 }
    if (cmd === 'vault_rules') return []
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const dismiss = (host: HTMLElement) => host.querySelector('.vt-error-line button[title="Dismiss"]')

let host: HTMLElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {} // jsdom has none
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('an error line offers × only when it can be dismissed', async () => {
  const { ErrorLine } = await import('./ErrorLine')
  const onDismiss = vi.fn()
  await act(async () => root.render(<ErrorLine text={'exit 2\nno vault'} onDismiss={onDismiss} />))
  expect(host.querySelector('pre.vt-error')?.textContent).toBe('exit 2\nno vault')
  await click(dismiss(host))
  expect(onDismiss).toHaveBeenCalledOnce()

  await act(async () => root.render(<ErrorLine text="stays" />))
  expect(host.querySelector('pre.vt-error')?.textContent).toBe('stays')
  expect(host.querySelector('button')).toBeNull()
})

test('dismissing an unreadable page deselects it', async () => {
  const { vault } = await import('./app-store')
  const { PageView } = await import('./PageView')
  // `deselect` comes from close-path; stub it here so this piece tests only what it calls.
  const deselect = vi.fn()
  vault.setState({ deselect } as never)
  await act(async () => root.render(<PageView cwd={undefined} />))
  await act(() => vault.getState().select(info.path))
  await flush()
  expect(host.querySelector('.vt-page-error pre.vt-error')?.textContent).toBe('Error: ENOENT: gone.md')
  await click(dismiss(host))
  expect(deselect).toHaveBeenCalledOnce()
})

test('a tree error is dismissed until the next read, which shows it again if it still fails', async () => {
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const { vault } = await import('./app-store')
  vault.setState({ mode: 'pages', loaded: false, treeError: null })
  const Pane = paneView('vault')!
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  expect(host.querySelector('.vt-side pre.vt-error')?.textContent).toBe('Error: mnemo status: no vault')

  await click(dismiss(host))
  expect(host.querySelector('.vt-side .vt-error')).toBeNull()

  const reread = async () => {
    await click(host.querySelector('.vt-bar button[title="Re-read the vault"]'))
    await flush()
  }
  await reread()
  expect(host.querySelector('.vt-side pre.vt-error')?.textContent).toBe('Error: mnemo status: no vault')

  treeFails = false
  await reread()
  expect(host.querySelector('.vt-side .vt-error')).toBeNull()
  expect(host.querySelector('.vt-agent-name')?.textContent).toBe('mnemo-desktop')
})

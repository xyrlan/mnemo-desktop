import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import { nexusStore } from './store'
import { liveDrawer } from './drawer/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The app's drawer reaches Tauri and xterm: one on a fake session host, a stub terminal and the
// fixture fleet. The ship is the fixture's until the `ship` piece lands.
vi.mock('./drawer/app', async () => {
  const { fakeHost } = await import('./drawer/fixtures')
  const { createDrawer } = await import('./drawer/sessions')
  const { createStore } = await import('zustand/vanilla')
  const { nexusStore } = await import('./store')
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
  return {
    liveDrawer: {
      drawer,
      host,
      owners: createStore(() => ({ owners: {} })),
      terminal: ({ id }: { id: number }) => (
        <div data-stub-terminal={id}>
          <textarea />
        </div>
      ),
      conversation: () => <div data-stub-conversation="" />,
      diff: { files: async () => ({ root: '', files: [], truncated: false }), sides: async () => ({ original: '', modified: '', binary: false, tooLarge: false }) },
      worktreeOf: (cwd: string) => cwd,
      goToRepo: () => {},
    },
  }
})
vi.mock('./ship', async () => {
  const { shipFixture } = await import('./drawer/fixtures')
  return { buildShip: () => shipFixture() }
})
vi.mock('../fleet/store', async () => {
  const { reposFixture } = await import('./drawer/fixtures')
  return { useFleet: <T,>(sel: (f: { repos: unknown }) => T) => sel({ repos: reposFixture }) }
})

const usage: NexusClient = { archives: async () => ({ projects: {}, universal: 0 }), logUsage: async () => {} }
const fake = () => {
  const c = {
    asked: 0,
    feed: async () => {
      c.asked++
      return { sessions: {}, prs: {}, rate: null, at: 1 }
    },
  }
  return c satisfies ShipClient
}
const view = () => document.querySelector('[data-nexus-view]')

afterEach(async () => {
  for (const t of nexusStore.getState().tabs) await liveDrawer.drawer.close(t.id)
  nexusStore.setState({ open: true, collapsed: false, drawerWidth: 600 })
  document.body.innerHTML = ''
})

const mount = async () => {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusView client={fake()} usage={usage} leftEdge={52} />))
}
const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

test('open, it covers the workbench from the sidebar’s edge and reads the feed', async () => {
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusView client={client} usage={usage} leftEdge={52} />))
  expect(view()).not.toBeNull()
  expect((view() as HTMLElement).style.left).toBe('52px')
  expect(client.asked).toBeGreaterThan(0)
  expect(document.querySelector('[data-ship-scene]')).not.toBeNull()
})

test('closed, it reads nothing and draws nothing', async () => {
  nexusStore.getState().setOpen(false)
  const client = fake()
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<NexusView client={client} usage={usage} leftEdge={0} />))
  expect(view()).toBeNull()
  expect(client.asked).toBe(0)
})

test('an exception opens its robot in the drawer, and the ship shrinks beside it', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  nexusStore.setState({ drawerWidth: 600 })
  await mount()
  expect((view() as HTMLElement).style.right).toBe('0px')
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => {})
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'r-live', focusId: 'r-live' })
  expect(document.querySelector('[data-drawer-tab="r-live"]')).not.toBeNull()
  expect((view() as HTMLElement).style.right).toBe('600px')
})

test('Esc collapses the drawer, the ship grows back; Esc in a tab’s terminal is the terminal’s', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  await mount()
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => {})
  press({ key: 'Escape' }, document.querySelector('[data-stub-terminal] textarea')!)
  expect(nexusStore.getState().collapsed).toBe(false)
  press({ key: 'Escape' })
  expect(nexusStore.getState()).toMatchObject({ collapsed: true, focusId: null })
  expect((view() as HTMLElement).style.right).toBe('0px')
  expect(document.querySelector('[data-drawer-handle]')).not.toBeNull()
})

test('closed with tabs open, the ship is gone and the drawer kept, hidden', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  await mount()
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => nexusStore.getState().setOpen(false))
  expect(view()).toBeNull()
  expect((document.querySelector('[data-nexus-drawer]') as HTMLElement).style.display).toBe('none')
  expect(document.querySelector('[data-stub-terminal]')).not.toBeNull()
})

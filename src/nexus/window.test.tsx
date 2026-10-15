import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccountsContext, createAccountsStore } from '../accounts/store'
import { account, fakeClient, settle } from '../accounts/testing'
import { installKeys } from '../actions/keys'
import Shell from '../shell/Shell'
import { mountInSlot, resetSlots } from '../shell/slots'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import { nexusStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* The Nexus in the app's window (issue #436): the real shell and the real account switcher. The
   Nexus is the app (#459): no workbench, sidebar or status bar under it. Only the drawer (Tauri,
   xterm) and the fleet module are stand-ins. */

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('./drawer/app', async () => {
  const { fakeHost } = await import('./drawer/fixtures')
  const { createDrawer } = await import('./drawer/sessions')
  const { createStore } = await import('zustand/vanilla')
  const { nexusStore } = await import('./store')
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  return {
    liveDrawer: {
      drawer,
      host,
      owners: createStore(() => ({ owners: {} })),
      terminal: () => <div />,
      conversation: () => <div />,
      diff: { files: async () => ({ root: '', files: [], truncated: false }), sides: async () => ({ original: '', modified: '', binary: false, tooLarge: false }) },
      worktreeOf: (cwd: string) => cwd,
      goToRepo: () => {},
      paneOfSession: () => null,
    },
  }
})
const fleet = vi.hoisted(() => ({ repos: [] as unknown[] }))
vi.mock('../fleet/store', () => ({ useFleet: <T,>(sel: (f: { repos: unknown[] }) => T) => sel(fleet) }))

const client: ShipClient = { feed: async () => ({ sessions: {}, prs: {}, rate: null, at: Date.now() }) }
const usage: NexusClient = { logUsage: async () => {} }
const Nexus = () => <NexusView client={client} usage={usage} />

let root: Root
let host: HTMLElement
let unkeys: () => void
let accounts: ReturnType<typeof fakeClient>

async function render() {
  accounts = fakeClient({ state: { active: 'default', accounts: [account('default', { label: 'Personal' }), account('work')] } })
  const store = createAccountsStore(accounts.client)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () =>
    root.render(
      <AccountsContext.Provider value={store}>
        <Shell />
      </AccountsContext.Provider>,
    ),
  )
  await act(settle)
  return store
}

beforeEach(() => {
  resetSlots()
  nexusStore.setState({ feed: null, log: [], tabs: [], collapsed: false })
  mountInSlot('overlay', Nexus)
  unkeys = installKeys('mac', { listen: async () => () => {} })
})
afterEach(() => {
  unkeys()
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const view = () => document.querySelector<HTMLElement>('[data-nexus-view]')
const press = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

test('the Nexus is the whole window, with nothing under it: no workbench, sidebar or status bar', async () => {
  await render()
  const v = view()!
  expect(v.classList).toContain('fixed')
  expect(v.classList).toContain('inset-0')
  expect(v.style.bottom).toBe('')
  expect(v.querySelector('[data-ship-scene]')).not.toBeNull()
  for (const sel of ['[data-shell-main]', '[data-shell-column]', '[data-shell-slot]', '[inert]']) expect(document.querySelector(sel)).toBeNull()
})

test('the account switcher is in the ship’s bar beside the counts, on the app’s accounts store', async () => {
  const store = await render()
  const bar = view()!.querySelector('header.ship-top')!
  const switcher = bar.querySelector<HTMLElement>('[data-account-switcher]')!
  expect(switcher.getAttribute('aria-label')).toBe('Claude accounts: Personal')
  // After the count chips; without the sidebar's margins.
  expect(bar.querySelector('[data-chip="rate"]')!.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(switcher.className).not.toMatch(/\bmx-2\b/)
  // A switch is the store's, wherever it was asked from: the bar follows it.
  await act(async () => void (await store.getState().switchTo('work')))
  expect(accounts.fake.called('switch')).toEqual([['switch', 'work']])
  expect(switcher.getAttribute('aria-label')).toBe('Claude accounts: Work')
})

test('nothing leaves the Nexus: no way back to a workbench, and ⌘0 or ⌘1 do nothing to it', async () => {
  await render()
  expect(view()!.querySelector('.ship-exit')).toBeNull()
  expect(view()!.textContent).not.toContain('WORKBENCH')
  press({ key: '0', code: 'Digit0', metaKey: true })
  press({ key: '1', code: 'Digit1', metaKey: true })
  expect(view()).not.toBeNull()
})

test('the account popup opens in a dark layer of the ship’s, outside the view', async () => {
  await render()
  const layer = document.querySelector('body > [data-ship-layer]')!
  expect(layer.classList).toContain('dark')
  expect(view()!.contains(layer)).toBe(false)
})

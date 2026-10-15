import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccountsContext, createAccountsStore } from '../accounts/store'
import { account, fakeClient, settle } from '../accounts/testing'
import { shortcutLabel } from '../actions/chords'
import { installKeys } from '../actions/keys'
import { register } from '../actions/registry'
import Shell from '../shell/Shell'
import { mountInSlot, resetSlots } from '../shell/slots'
import { DEFAULTS, shellStore } from '../shell/store'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import { nexusStore } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* The Nexus in the app's window (issue #436): the real shell and the real account switcher, the
   workbench a stand-in pane that counts its mounts, the sidebar and status bar stand-ins in their
   slots. Only the drawer (Tauri, xterm) and the fleet module are stand-ins on the Nexus's side. */

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The workbench's panes: which are mounted, which is the active one, and the one that focuses its
// terminal as it mounts (the terminal view does, for the focused pane a restore brings back).
const workbench = vi.hoisted(() => ({ mounts: 0, panes: ['a'], focused: 'a', selfFocus: null as string | null, redraw: () => {} }))
vi.mock('../shell/Workbench', async () => {
  const { createElement, useEffect, useReducer, useRef } = await import('react')
  function Pane({ id }: { id: string }) {
    const input = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
      if (workbench.selfFocus === id) input.current?.focus()
    }, [id])
    const cls = `pane${workbench.focused === id ? ' focused' : ''}`
    return createElement('div', { className: cls, 'data-pane': id }, createElement('div', { className: 'pane-content' }, createElement('textarea', { ref: input, 'aria-label': id })))
  }
  return {
    default: function Workbench() {
      const [, redraw] = useReducer((n: number) => n + 1, 0)
      workbench.redraw = redraw
      useEffect(() => void workbench.mounts++, [])
      return createElement('div', null, ...workbench.panes.map((id) => createElement(Pane, { key: id, id })))
    },
  }
})
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

const went: string[] = []
register({ id: 'nexus.toggle', title: 'Nexus', run: () => nexusStore.getState().toggle() })
register({ id: 'worktree.go.1', title: 'Go to workspace 1', run: () => void went.push('worktree 1') })

const client: ShipClient = { feed: async () => ({ sessions: {}, prs: {}, rate: null, at: Date.now() }) }
const usage: NexusClient = { logUsage: async () => {} }
const Nexus = () => <NexusView client={client} usage={usage} />
const Sidebar = () => <nav data-left="">workspaces</nav>
const StatusBar = () => <footer data-status="">status</footer>

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
        <Shell ready notice={null} onDismissNotice={() => {}} />
      </AccountsContext.Provider>,
    ),
  )
  await act(settle)
  return store
}

beforeEach(() => {
  resetSlots()
  shellStore.setState(DEFAULTS)
  nexusStore.setState({ open: true, feed: null, log: [], tabs: [], collapsed: false })
  mountInSlot('left-sidebar', Sidebar)
  mountInSlot('status-bar', StatusBar)
  mountInSlot('overlay', Nexus)
  Object.assign(workbench, { mounts: 0, panes: ['a'], focused: 'a', selfFocus: null })
  went.length = 0
  unkeys = installKeys('mac', { listen: async () => () => {}, sendChords: async () => {} })
})
afterEach(() => {
  unkeys()
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const view = () => document.querySelector<HTMLElement>('[data-nexus-view]')
const press = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

test('open, it covers the whole window but the status bar, and the workbench and sidebar stay mounted under it', async () => {
  await render()
  const v = view()!
  // From the window's top-left corner to its right edge, down to the status bar.
  expect(v.classList).toContain('inset-x-0')
  expect(v.classList).toContain('top-0')
  expect(v.classList).toContain('fixed')
  expect(v.style.left).toBe('')
  expect(v.style.top).toBe('')
  expect(v.style.bottom).toBe('24px')
  expect(v.querySelector('[data-ship-scene]')).not.toBeNull()
  // Under it, not in it: the sidebar, the workbench's pane, the status bar.
  for (const sel of ['[data-left]', '[data-pane]', '[data-status]']) {
    expect(document.querySelector(sel)).not.toBeNull()
    expect(v.contains(document.querySelector(sel))).toBe(false)
  }
  expect(workbench.mounts).toBe(1)
})

test('⌘0 goes back to the workbench as it was, sidebar included, and comes back; the pane is never remounted', async () => {
  await render()
  const pane = document.querySelector('[data-pane]')
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(nexusStore.getState().open).toBe(false)
  expect(view()).toBeNull()
  expect(document.querySelector('[data-shell-column="left"]')!.getAttribute('data-open')).toBe('true')
  expect(document.querySelector('[data-left]')).not.toBeNull()
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(view()).not.toBeNull()
  expect(document.querySelector('[data-pane]')).toBe(pane)
  expect(workbench.mounts).toBe(1)
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

test('the bar’s way back to the workbench runs ⌘0’s action', async () => {
  await render()
  const back = view()!.querySelector<HTMLButtonElement>('header.ship-top .ship-exit')!
  expect(back.title).toBe(`Back to the workbench (${shortcutLabel('nexus.toggle')})`)
  await act(async () => back.click())
  expect(nexusStore.getState().open).toBe(false)
  expect(document.querySelector('[data-left]')).not.toBeNull()
})

test('⌘1–9 from the Nexus go to the worktree and show the workbench', async () => {
  await render()
  press({ key: '1', code: 'Digit1', metaKey: true })
  expect(went).toEqual(['worktree 1'])
  expect(nexusStore.getState().open).toBe(false)
})

test('opened over a focused workbench terminal, the keys are the Nexus’s', async () => {
  nexusStore.setState({ open: false })
  await render()
  const terminal = document.querySelector<HTMLTextAreaElement>('[data-pane] textarea')!
  terminal.focus()
  expect(document.activeElement).toBe(terminal)
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(view()).not.toBeNull()
  expect(document.activeElement).toBe(document.body)
})

const main = () => document.querySelector<HTMLElement>('[data-shell-main]')!
const pane = (id: string) => document.querySelector<HTMLTextAreaElement>(`[data-pane="${id}"] textarea`)!
/** The workbench draws again: a pane mounts, or the active one changes. */
const redraw = (change: Partial<typeof workbench>) => act(() => void (Object.assign(workbench, change), workbench.redraw()))

test('open, the sidebars and the workbench are inert, the status bar is not; closed, nothing is', async () => {
  await render()
  expect(main().hasAttribute('inert')).toBe(true)
  expect(main().contains(document.querySelector('[data-left]'))).toBe(true)
  expect(main().contains(document.querySelector('[data-pane]'))).toBe(true)
  expect(main().contains(document.querySelector('[data-status]'))).toBe(false)
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(main().hasAttribute('inert')).toBe(false)
})

test('at launch, a pane the restore brings back after the Nexus opened cannot take the keys', async () => {
  // The app opens on the Nexus; the saved workspace lands later and focuses its pane.
  await render()
  workbench.selfFocus = 'b'
  await redraw({ panes: ['a', 'b'], focused: 'b' })
  expect(pane('b')).not.toBeNull()
  expect(document.activeElement).toBe(document.body)
  // So Tab is the Nexus's, and ⌘0 then gives the focus to the restored pane.
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(document.activeElement).toBe(pane('b'))
})

test('⌘0 back gives the focus back to the pane that had it', async () => {
  nexusStore.setState({ open: false })
  workbench.panes = ['a', 'b']
  await render()
  pane('a').focus()
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(document.activeElement).toBe(document.body)
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(document.activeElement).toBe(pane('a'))
})

test('⌘0 back focuses the active pane when the one that had the focus is no longer active', async () => {
  nexusStore.setState({ open: false })
  workbench.panes = ['a', 'b']
  await render()
  pane('a').focus()
  press({ key: '0', code: 'Digit0', metaKey: true })
  // Gone to from the Nexus (the drawer's open as tab): pane b is active, and focused itself unseen.
  await redraw({ focused: 'b' })
  pane('b').focus()
  expect(document.activeElement).toBe(document.body)
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(document.activeElement).toBe(pane('b'))
})

test('the account popup opens in a dark layer of the ship’s, gone with the Nexus', async () => {
  await render()
  const layer = document.querySelector('body > [data-ship-layer]')!
  expect(layer.classList).toContain('dark')
  expect(view()!.contains(layer)).toBe(false)
  press({ key: '0', code: 'Digit0', metaKey: true })
  expect(document.querySelector('[data-ship-layer]')).toBeNull()
})

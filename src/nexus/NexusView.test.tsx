import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from '@/ui'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import type { Feed, Ship, ShipSceneProps } from './ship-types'
import { nexusStore } from './store'
import { liveDrawer } from './drawer/app'
import { shipFixture } from './drawer/fixtures'

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
      paneOfSession: () => null,
    },
  }
})
// What each build and each log call was given, and the scene's props.
const seen = vi.hoisted(() => ({ feeds: [] as unknown[], logged: 0, scene: null as unknown, ship: null as null | (() => unknown) }))
vi.mock('./ship', async (importOriginal) => {
  const { shipFixture } = await import('./drawer/fixtures')
  return {
    ...(await importOriginal<object>()),
    buildShip: (input: { feed: unknown }) => (seen.feeds.push(input.feed), seen.ship ? seen.ship() : shipFixture()),
  }
})
vi.mock('./log', async (importOriginal) => {
  const real = await importOriginal<typeof import('./log')>()
  return { ...real, logEvents: (...a: Parameters<typeof real.logEvents>) => (seen.logged++, real.logEvents(...a)) }
})
vi.mock('./ShipScene', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ShipScene')>()
  return {
    ...real,
    ShipScene: (p: ShipSceneProps) => {
      seen.scene = p
      return <real.ShipScene {...p} />
    },
  }
})
vi.mock('./command/actions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAction: async () => ({ ok: false, say: 'merge refused: checks are red', log: [] }),
}))
vi.mock('@/ui', async (importOriginal) => ({ ...(await importOriginal<object>()), toast: { error: vi.fn() } }))
vi.mock('../fleet/store', async () => {
  const { reposFixture } = await import('./drawer/fixtures')
  return { useFleet: <T,>(sel: (f: { repos: unknown }) => T) => sel({ repos: reposFixture }) }
})

const usage: NexusClient = { logUsage: async () => {} }
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
/** The ship's box in the view: the room beside it is the drawer's. */
const ship = () => document.querySelector<HTMLElement>('[data-nexus-ship]')!

const roots: Root[] = []
const render = async (client: ShipClient = fake()) => {
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  roots.push(root)
  await act(async () => root.render(<NexusView client={client} usage={usage} />))
}
const mount = () => render()

beforeEach(() => Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true }))
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  for (const t of nexusStore.getState().tabs) await liveDrawer.drawer.close(t.id)
  nexusStore.setState({ open: true, collapsed: false, drawerWidth: 600, feed: null, triage: false, triageAsked: false })
  seen.ship = null
  seen.feeds.length = 0
  seen.logged = 0
  document.body.innerHTML = ''
})
const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

test('open, it reads the feed and draws the ship', async () => {
  const client = fake()
  await render(client)
  expect(view()).not.toBeNull()
  expect(client.asked).toBeGreaterThan(0)
  expect(document.querySelector('[data-ship-scene]')).not.toBeNull()
})

test('closed, it reads nothing and draws nothing', async () => {
  nexusStore.getState().setOpen(false)
  const client = fake()
  await render(client)
  expect(view()).toBeNull()
  expect(client.asked).toBe(0)
})

test('an exception opens its robot in the drawer, and the ship shrinks beside it', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  nexusStore.setState({ drawerWidth: 600 })
  await mount()
  expect(ship().style.marginRight).toBe('0px')
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => {})
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'r-live', focusId: 'r-live' })
  expect(document.querySelector('[data-drawer-tab="r-live"]')).not.toBeNull()
  expect(ship().style.marginRight).toBe('600px')
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
  expect(ship().style.marginRight).toBe('0px')
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

test('reopened, the ship is drawn with the last feed, and nothing is logged before this opening’s first feed', async () => {
  await mount()
  const first = nexusStore.getState().feed
  expect(first).not.toBeNull()
  expect(seen.logged).toBeGreaterThan(0)
  await act(async () => nexusStore.getState().setOpen(false))
  seen.feeds.length = 0
  seen.logged = 0
  // A feed that has not answered yet.
  let answer: (f: Feed) => void = () => {}
  const slow: ShipClient = { feed: () => new Promise<Feed>((r) => (answer = r)) }
  for (const r of roots.splice(0)) act(() => r.unmount())
  await render(slow)
  await act(async () => nexusStore.getState().setOpen(true))
  expect(seen.feeds.length).toBeGreaterThan(0)
  expect(seen.feeds.every((f) => f === first)).toBe(true)
  expect(seen.logged).toBe(0)
  await act(async () => answer({ sessions: {}, prs: {}, rate: null, at: 2 }))
  expect(seen.feeds.at(-1)).toMatchObject({ at: 2 })
  expect(seen.logged).toBeGreaterThan(0)
})

test('an action from the ship that is refused says why', async () => {
  await mount()
  const scene = seen.scene as ShipSceneProps
  await act(async () => scene.onAction({ kind: 'merge', robotIds: ['r-live'] }))
  expect(toast.error).toHaveBeenCalledWith('merge refused: checks are red')
})

test('triage asked from the sidebar opens on a blocked robot', async () => {
  const blocked = (): Ship => {
    const s = shipFixture()
    const r = { ...s.decks[0].flight[0], state: 'need' as const, zone: 'bridge' as const, need: { kind: 'question' as const, text: 'which one?', options: ['a', 'b'] } }
    return { ...s, bridge: { exceptions: [{ kind: 'need', robotId: r.id, need: r.need }], blocked: [r] }, counts: { ...s.counts, need: 1 } }
  }
  seen.ship = blocked
  nexusStore.getState().setOpen(false)
  await mount()
  await act(async () => nexusStore.getState().askTriage())
  expect(nexusStore.getState()).toMatchObject({ open: true, triage: true, triageAsked: false })
})

test('triage asked when only a captain waits opens the Nexus alone: triage has no card for it', async () => {
  // The sidebar counts a waiting interactive session as needing you; the ship lists no robot.
  seen.ship = () => {
    const s = shipFixture()
    return { ...s, decks: [{ ...s.decks[0], captains: s.decks[0].captains.map((c, i) => (i === 0 ? { ...c, pose: 'alert' as const } : c)) }] }
  }
  nexusStore.getState().setOpen(false)
  await mount()
  await act(async () => nexusStore.getState().askTriage())
  expect(view()).not.toBeNull()
  expect(nexusStore.getState()).toMatchObject({ open: true, triage: false, triageAsked: false })
  expect(document.body.textContent).not.toContain('all settled')
})

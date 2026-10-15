import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from '@/ui'
import type { NexusClient } from './client'
import { NexusView } from './NexusView'
import type { ShipClient } from './ship-client'
import type { Feed, Ship, ShipSceneProps } from './ship-types'
import { openFigure } from './outside'
import { nexusStore } from './store'
import { liveDrawer } from './drawer/app'
import { shipFixture } from './drawer/fixtures'
import { confirm } from './ui/confirm'
import { closeWindow, openWindow, registerWindow, windowStore } from './ui/windows'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The app's drawer reaches Tauri and xterm: one on a fake session host, a stub terminal and the
// fixture fleet. The ship is the fixture's until the `ship` piece lands.
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
  nexusStore.setState({ collapsed: false, drawerWidth: 600, feed: null, triage: false, selection: new Set() })
  seen.ship = null
  seen.feeds.length = 0
  seen.logged = 0
  document.body.innerHTML = ''
})
const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

test('it reads the feed and draws the ship, over the whole window', async () => {
  const client = fake()
  await render(client)
  expect(view()).not.toBeNull()
  expect(client.asked).toBeGreaterThan(0)
  expect(document.querySelector('[data-ship-scene]')).not.toBeNull()
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

test('remounted, the ship is drawn with the last feed, and nothing is logged before this mount’s first feed', async () => {
  await mount()
  const first = nexusStore.getState().feed
  expect(first).not.toBeNull()
  expect(seen.logged).toBeGreaterThan(0)
  for (const r of roots.splice(0)) act(() => r.unmount())
  seen.feeds.length = 0
  seen.logged = 0
  // A feed that has not answered yet.
  let answer: (f: Feed) => void = () => {}
  const slow: ShipClient = { feed: () => new Promise<Feed>((r) => (answer = r)) }
  await render(slow)
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

/** A real ship (`buildShip`) whose one captain waits on a permission, and no child. */
const LEAD = '11111111-aaaa-4bbb-8ccc-000000000001'
async function captainWaits(): Promise<() => Ship> {
  const { buildShip } = await vi.importActual<typeof import('./ship')>('./ship')
  const parents = [{ session_id: LEAD, pid: 1, name: 'fleet lead', status: 'waiting', waiting_for: 'permission prompt', cwd: '/Users/you/github/mnemo-desktop' }]
  const snapshot = { repos: [{ root: '/Users/you/github/mnemo-desktop', name: 'mnemo-desktop', parents, missions: [], children: [] }], errors: [], at: new Date(0).toISOString() }
  return () => buildShip({ snapshot, feed: null, agents: { [LEAD]: { state: 'needs-you', waitingFor: 'permission', title: 'fleet lead' } }, events: [], firstSeen: {}, now: 1_000 })
}

test('Tab opens triage on a captain’s card when only a captain waits', async () => {
  const ship = await captainWaits()
  expect(ship().counts.need).toBe(1)
  seen.ship = ship
  await mount()
  press({ key: 'Tab' })
  expect(nexusStore.getState().triage).toBe(true)
  const card = document.querySelector('[data-triage-card]')!
  expect([card.getAttribute('data-triage-card'), card.getAttribute('data-triage-kind')]).toEqual([LEAD, 'captain'])
  expect(document.querySelector('[data-triage-question]')!.textContent).toBe('🔒 waits on a permission')
})

test('⌥N opens a waiting captain’s row in the drawer', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  seen.ship = await captainWaits()
  await mount()
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => {})
  expect(nexusStore.getState()).toMatchObject({ activeTab: LEAD })
})

// ---------- #451: windows, confirmations and menus with the drawer open ----------

// What paints over what for these fixed layers, as the browser decides it: each element's stacking
// context at the top of the page (its outermost ancestor with a z-index), then document order
// between equals. Each z-index is read from the sheet that sets it. vitest hands a `?raw` sheet over
// empty: read from disk. The app has no Node types, so the one fs call is typed here.
type Fs = { readFileSync(p: string, e: 'utf8'): string }
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as Fs
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
const Z: Record<string, number> = {}
for (const m of fs.readFileSync(`${cwd}/src/theme.css`, 'utf8').matchAll(/--z-index-([\w-]+):\s*(\d+)/g)) Z[`z-${m[1]}`] = Number(m[2])
for (const sheet of ['src/nexus/ui/ui.css', 'src/nexus/accounts/accounts.css'])
  for (const m of fs.readFileSync(`${cwd}/${sheet}`, 'utf8').matchAll(/\.([\w-]+)\s*\{[^}]*?z-index:\s*(\d+)/g)) Z[m[1]] = Number(m[2])
const zOf = (el: Element): number | null => {
  const z = [...el.classList].map((c) => Z[c]).filter((n) => n !== undefined)
  return z.length ? Math.max(...z) : null
}
/** The layer `el` is painted in at the top of the page, and its z-index. */
function layerOf(el: Element): { el: Element; z: number } {
  let top: { el: Element; z: number } = { el, z: 0 }
  for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
    const z = zOf(a)
    if (z !== null) top = { el: a, z }
  }
  return top
}
/** `a` is painted over `b`. */
function paintsOver(a: Element, b: Element): boolean {
  const la = layerOf(a)
  const lb = layerOf(b)
  if (la.el === lb.el) return false
  if (la.z !== lb.z) return la.z > lb.z
  return !!(lb.el.compareDocumentPosition(la.el) & Node.DOCUMENT_POSITION_FOLLOWING)
}

const mac = () => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
/** Opens r-live in the drawer, the drawer open beside the ship. */
async function withDrawer(): Promise<HTMLElement> {
  mac()
  press({ key: '1', code: 'Digit1', altKey: true })
  await act(async () => {})
  const aside = document.querySelector<HTMLElement>('[data-nexus-drawer]')!
  expect(aside.style.display).toBe('flex')
  return aside
}
let unregister = () => {}
const openTestWindow = async () => {
  unregister = registerWindow({
    id: 'zz-test',
    title: 'Test',
    render: () => (
      <div>
        <button type="button" data-zz-go="">
          go
        </button>
        <input data-zz-find="" onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()} />
      </div>
    ),
  })
  await act(async () => openWindow('zz-test'))
  return document.querySelector<HTMLElement>('[data-zz-go]')!
}
afterEach(() => {
  act(() => closeWindow())
  unregister()
})

test('a window, a confirmation and a menu are drawn over the open drawer, not under it', async () => {
  await mount()
  const aside = await withDrawer()

  await openTestWindow()
  const backdrop = document.querySelector('[data-nx-backdrop]')!
  expect(paintsOver(backdrop, aside)).toBe(true)
  expect(view()!.contains(backdrop)).toBe(false)

  let asked: Promise<boolean> = Promise.resolve(false)
  act(() => void (asked = confirm({ title: 'Close it?', confirm: 'Close', danger: true })))
  const question = document.querySelector('[data-nx-confirm]')!
  expect(paintsOver(question, aside)).toBe(true)
  expect(paintsOver(question, backdrop)).toBe(true)
  // The account switcher's list, in its layer at the end of `<body>`, stays under the question.
  const layer = document.body.appendChild(document.createElement('div'))
  const pop = layer.appendChild(document.createElement('div'))
  pop.className = 'nx nx-pop'
  expect(paintsOver(question, pop)).toBe(true)
  await act(async () => void document.querySelector<HTMLButtonElement>('[data-nx-confirm] [data-tone]')!.click())
  expect(await asked).toBe(true)
  act(() => closeWindow())

  const scene = seen.scene as ShipSceneProps
  act(() => scene.onMenu?.({ kind: 'robot', id: 'r-live' }, 1500, 200))
  const menu = document.querySelector('[data-nx-menu]')!
  expect(paintsOver(menu, aside)).toBe(true)
})

test('Triage and the selection bar are drawn over the open drawer, under a window', async () => {
  seen.ship = blockedShip
  await mount()
  const aside = await withDrawer()
  await act(async () => nexusStore.getState().toggleSelect('r-live'))
  const bar = document.querySelector('[data-selection-bar]')!
  expect(paintsOver(bar, aside)).toBe(true)
  expect(view()!.contains(bar)).toBe(false)

  await act(async () => nexusStore.getState().setTriage(true))
  const triage = document.querySelector('[data-triage]')!
  expect(paintsOver(triage, aside)).toBe(true)
  expect(view()!.contains(triage)).toBe(false)
  await openTestWindow()
  expect(paintsOver(document.querySelector('[data-nx-backdrop]')!, triage)).toBe(true)
  await act(async () => nexusStore.getState().clearSelection())
})

/** The fixture ship with r-live blocked on a question: Tab has something to triage. */
const blockedShip = (): Ship => {
  const s = shipFixture()
  const r = { ...s.decks[0].flight[0], state: 'need' as const, zone: 'bridge' as const, need: { kind: 'question' as const, text: 'which one?', options: ['a', 'b'] } }
  return { ...s, bridge: { exceptions: [{ kind: 'need', robotId: r.id, need: r.need }], blocked: [r] }, counts: { ...s.counts, need: 1 } }
}

test('with a window or a confirmation open, Tab, `/` and ⌥1–9 are not the ship’s', async () => {
  mac()
  seen.ship = blockedShip
  await mount()
  const go = await openTestWindow()
  go.focus()
  press({ key: 'Tab' }, go)
  expect(nexusStore.getState().triage).toBe(false)
  press({ key: '/' }, go)
  expect(document.activeElement).toBe(go)
  press({ key: '1', code: 'Digit1', altKey: true }, go)
  expect(nexusStore.getState().tabs).toEqual([])
  act(() => closeWindow())

  act(() => void confirm({ title: 'Stop it?', confirm: 'Stop' }))
  press({ key: 'Tab' })
  expect(nexusStore.getState().triage).toBe(false)
  await act(async () => void document.querySelector<HTMLButtonElement>('[data-nx-confirm] .nx-btn')!.click())

  // With nothing over the ship, they are its again.
  press({ key: 'Tab' })
  expect(nexusStore.getState().triage).toBe(true)
})

test('with a window open, Esc typed in the drawer’s terminal is the terminal’s; typed in the window, it closes the window', async () => {
  await mount()
  await withDrawer()
  const terminal = document.querySelector<HTMLTextAreaElement>('[data-stub-terminal] textarea')!
  let heard = 0
  terminal.addEventListener('keydown', (e) => e.key === 'Escape' && heard++)
  const go = await openTestWindow()

  press({ key: 'Escape' }, terminal)
  expect(heard).toBe(1)
  expect(windowStore.getState().open?.id).toBe('zz-test')
  // An Esc something in the window takes for itself (Monaco's find closing) leaves the window.
  press({ key: 'Escape' }, document.querySelector('[data-zz-find]')!)
  expect(windowStore.getState().open?.id).toBe('zz-test')

  press({ key: 'Escape' }, go)
  expect(windowStore.getState().open).toBeNull()
  // The view's own Esc did not also collapse the drawer.
  expect(nexusStore.getState().collapsed).toBe(false)
})

test('a window opens a figure in the drawer as a menu does, and closes so its tab is in view', async () => {
  await mount()
  let answered: boolean[] = []
  unregister = registerWindow({
    id: 'zz-open',
    title: 'Opens',
    render: (_params, _close, ctx) => (
      <>
        <button type="button" data-zz-open="r-live" onClick={() => answered.push(ctx.open('r-live'))} />
        <button type="button" data-zz-open="gone" onClick={() => answered.push(ctx.open('not-on-the-ship'))} />
      </>
    ),
  })
  await act(async () => openWindow('zz-open'))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-zz-open="gone"]')!.click())
  expect(answered).toEqual([false])
  expect(windowStore.getState().open?.id).toBe('zz-open')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-zz-open="r-live"]')!.click())
  expect(answered).toEqual([false, true])
  expect(windowStore.getState().open).toBeNull()
  expect(nexusStore.getState().activeTab).toBe('r-live')
  answered = []
})

test('openFigure opens a figure from anywhere in the app as a click does; false for what the ship does not know, or with no Nexus mounted', async () => {
  expect(openFigure('r-live')).toBe(false)
  await mount()
  let opened = false
  act(() => void (opened = openFigure('r-live')))
  expect(opened).toBe(true)
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'r-live', collapsed: false })
  expect(document.querySelector('[data-drawer-tab="r-live"]')).not.toBeNull()
  act(() => void (opened = openFigure('not-on-the-ship')))
  expect(opened).toBe(false)
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['r-live'])
})

test('openFigure closes an open window, as the window’s own open does, so the tab is not left under it; what it cannot open leaves the window', async () => {
  await mount()
  unregister = registerWindow({ id: 'zz-over', title: 'Over', render: () => <p data-zz-over="" /> })
  await act(async () => openWindow('zz-over'))
  act(() => void openFigure('not-on-the-ship'))
  expect(windowStore.getState().open?.id).toBe('zz-over')
  act(() => void openFigure('r-live'))
  expect(windowStore.getState().open).toBeNull()
  expect(document.querySelector('[data-zz-over]')).toBeNull()
  expect(nexusStore.getState().activeTab).toBe('r-live')
  for (const r of roots.splice(0)) act(() => r.unmount())
  expect(openFigure('r-live')).toBe(false)
})

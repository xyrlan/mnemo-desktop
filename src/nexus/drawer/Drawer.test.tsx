import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import { register, run } from '../../actions/registry'
import { BACKSPACE, CLEAR_LINE, ENTER, promptBytes } from '../../chat-input/pty'
import type { ConversationViewProps } from '../../conversation/ConversationView'
import type { DiffClient } from '../../diff/client'
import type { PaneViewProps } from '../../panes/registry'
import type { Ship } from '../ship-types'
import { nexusStore } from '../store'
import { sessionAgent } from './agent'
import { NexusDrawer, type DrawerDeps } from './Drawer'
import { fakeHost, INPUT, reposFixture, settle, shipFixture } from './fixtures'
import { claimFace } from './keys'
import { openingOf, OUTSIDE } from './model'
import { createDrawer, viewName } from './sessions'
import { readWidth, WIDTH_KEY } from './width'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** What each terminal view went through: mounts, and `props.active` at each render. */
const views: Record<number, { mounts: number; active: boolean[]; props: Record<string, unknown> }> = {}
function StubTerminal({ id, props }: PaneViewProps) {
  const v = (views[id] ??= { mounts: 0, active: [], props })
  v.props = props
  if (v.active.at(-1) !== props.active) v.active.push(props.active === true)
  useEffect(() => {
    v.mounts++
  }, [v])
  return (
    <div data-stub-terminal={id}>
      <textarea />
    </div>
  )
}

type ConvProps = Pick<ConversationViewProps, 'sessionId' | 'cwd' | 'status' | 'agent' | 'onOpenTerminal'>
/** What each conversation view went through, by session: mounts, and its props last drawn. */
const convs: Record<string, { mounts: number; props: ConvProps }> = {}
function StubConversation(props: ConvProps) {
  const c = (convs[props.sessionId ?? ''] ??= { mounts: 0, props })
  c.props = props
  useEffect(() => {
    c.mounts++
  }, [c])
  return (
    <div data-stub-conversation={props.sessionId ?? ''}>
      <textarea data-composer="" />
    </div>
  )
}

/** The keys typed into each PTY, as the conversations' agents type them. */
const typed: string[] = []
const screen = INPUT
const write = async (pty: number, d: string) => void typed.push(`${pty} ${JSON.stringify(d)}`)
const keys = { writePty: write, screen: () => screen, sleep: async () => {} }
const sinks = { pane: { ...keys, runsClaude: async () => true }, attach: keys }

const diffAsked: string[] = []
const diff: DiffClient = {
  files: async (w) => (diffAsked.push(w), { root: w, truncated: false, files: [{ path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false }] }),
  sides: async () => ({ original: 'one\ntwo', modified: 'one\nTWO', binary: false, tooLarge: false }),
}

let root: Root
function mount(over: { shown?: boolean; ship?: Ship } = {}) {
  const { host, log } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
  const owners = createStore<{ owners: Record<number, { name?: string } | undefined> }>(() => ({ owners: {} }))
  const opened: string[] = []
  const deps: DrawerDeps = {
    drawer,
    host,
    owners,
    terminal: StubTerminal,
    conversation: StubConversation,
    agent: (session) => sessionAgent(session, sinks),
    diff,
    worktreeOf: (cwd) => cwd,
    goToRepo: () => {},
    paneOfSession: () => null,
  }
  const ship = over.ship ?? shipFixture()
  const open = (id: string) => {
    const o = openingOf(id, ship, reposFixture)!
    act(() => drawer.open(o.tab, o.ref))
  }
  const el = document.body.appendChild(document.createElement('div'))
  root = createRoot(el)
  const render = (shown = over.shown ?? true) =>
    act(() => root.render(<NexusDrawer deps={deps} ship={ship} feed={null} repos={reposFixture} shown={shown} onOpen={(id) => void opened.push(id)} />))
  render()
  return { host, log, drawer, owners, open, render, opened }
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const panel = (id: string) => $(`[data-drawer-panel="${id}"]`)!
const aside = () => $('[data-nexus-drawer]')!
const key = (init: KeyboardEventInit, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

beforeEach(() => {
  for (const k of Object.keys(views)) delete views[Number(k)]
  for (const k of Object.keys(convs)) delete convs[k]
  typed.length = 0
  diffAsked.length = 0
  nexusStore.setState({ open: true, tabs: [], activeTab: null, collapsed: false, focusId: null, drawerWidth: 600 })
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

test('with no tab nothing is drawn; a tab per session opened, with its state dot, sprite and label', async () => {
  const { open } = mount()
  expect(aside()).toBeNull()
  open('r-live')
  open('cap-1')
  open('r-live')
  await act(settle)
  const tabs = [...document.querySelectorAll('[data-drawer-tab]')]
  expect(tabs.map((t) => t.textContent)).toEqual(['#682·a', 'nexus round'])
  expect(tabs[0].querySelector('[role="img"]')?.className).toContain('bg-state-working')
  expect(tabs[0].querySelector('img')).not.toBeNull()
  expect(aside().style.width).toBe('600px')
})

test('the header: breadcrumbs that open the captain, the state, the context size', async () => {
  const { open, opened } = mount()
  open('r-live')
  await act(settle)
  const p = panel('r-live')
  expect(p.querySelector('[data-drawer-crumbs]')?.textContent).toBe('mnemo-desktop▸◆ nexus round▸#682·a')
  expect(p.querySelector('[data-drawer-state]')?.textContent).toBe('working')
  expect(p.textContent).toContain('context 182k')
  act(() => [...p.querySelectorAll('[data-drawer-crumbs] button')].find((b) => b.textContent === '◆ nexus round')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(opened).toEqual(['cap-1'])
})

test('a tab hidden and shown again takes its session back, without a remount', async () => {
  const { open, host } = mount()
  open('r-live')
  await act(settle)
  open('cap-1')
  const attach = host.getState().sessions['child:r-live'].pty!
  expect(panel('r-live').style.display).toBe('none')
  expect(panel('cap-1').style.display).toBe('flex')
  act(() => nexusStore.getState().activateTab('r-live'))
  expect(views[attach]).toMatchObject({ mounts: 1, active: [true, false, true] })
  expect(views[attach].props).toMatchObject({ present: true, name: viewName('r-live') })
  expect(views[7]).toMatchObject({ mounts: 1, active: [true, false] })
  expect(aside().dataset.sessionPty).toBe(String(attach))
})

test('collapsed, the drawer is hidden, its terminals still mounted and held, behind a handle', async () => {
  const { open, host, log } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  key({ key: '\\', code: 'Backslash', metaKey: true }, panel('cap-1').querySelector('textarea')!)
  expect(nexusStore.getState().collapsed).toBe(true)
  expect(aside().style.display).toBe('none')
  expect(document.querySelectorAll('[data-stub-terminal]')).toHaveLength(2)
  expect(views[7].active.at(-1)).toBe(false)
  expect(Object.keys(host.getState().sessions)).toHaveLength(2)
  expect(log).not.toContain('kill 60')
  expect($('[data-drawer-handle]')?.textContent).toBe('⟨ 2 sessions open · ⌘\\')
  act(() => $('[data-drawer-handle]')!.click())
  expect(nexusStore.getState().collapsed).toBe(false)
  expect(views[7]).toMatchObject({ mounts: 1, active: [true, false, true] })
})

test('the Nexus closed, the drawer stays mounted and hidden, with no handle', async () => {
  const { open, render } = mount()
  open('cap-1')
  render(false)
  expect(aside().style.display).toBe('none')
  expect($('[data-drawer-handle]')).toBeNull()
  expect(views[7]).toMatchObject({ mounts: 1, active: [true, false] })
})

test('× closes the tab and lets its session go', async () => {
  const { open, host } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  await act(async () => $<HTMLButtonElement>('[aria-label="Close nexus round"]')!.click())
  expect(host.getState().sessions['pane:7']).toBeUndefined()
  expect([...document.querySelectorAll('[data-drawer-tab]')].map((t) => t.textContent)).toEqual(['#682·a'])
})

test('a captain alive outside the app shows its conversation read-only and says why; nothing is spawned', async () => {
  const { open, log } = mount()
  open('cap-2')
  await act(settle)
  expect(panel('cap-2').querySelector('[data-drawer-readonly]')?.textContent).toContain(OUTSIDE)
  expect($('[data-stub-conversation="cap-2"]')).not.toBeNull()
  expect($('[data-stub-terminal]')).toBeNull()
  expect($('[data-open-as-tab]')).toBeNull()
  expect(aside().dataset.sessionPty).toBe('')
  expect(log).toEqual([])
})

test('a tab whose view does not own its session says so', async () => {
  const { open, owners } = mount()
  open('cap-1')
  act(() => owners.setState({ owners: { 7: { name: viewName('cap-1') } } }))
  expect($('[data-drawer-elsewhere]')).toBeNull()
  act(() => owners.setState({ owners: { 7: {} } }))
  expect($('[data-drawer-elsewhere]')).not.toBeNull()
})

test('a chip opens the quick diff; Esc closes it first, and only then does the drawer collapse', async () => {
  const { open } = mount()
  open('r-live')
  await act(settle)
  expect(diffAsked).toContain('/work/mnemo-desktop-wt-682/src')
  const chip = $<HTMLButtonElement>('[data-file-chip="src/a.ts"]')!
  await act(async () => chip.click())
  await act(settle)
  const pop = $('[data-quick-diff="src/a.ts"]')!
  expect(pop.textContent).toContain('+1 −1')
  expect([...pop.querySelectorAll('.whitespace-pre')].map((l) => l.textContent)).toEqual(['one', '-two', '+TWO'])
  key({ key: 'Escape' }, chip)
  expect($('[data-quick-diff]')).toBeNull()
  expect(nexusStore.getState().collapsed).toBe(false)
})

test('dragging the left edge draws a guide, and the drawer takes and keeps the width when the drag ends', () => {
  const { open } = mount()
  open('cap-1')
  const edge = $('[data-drawer-resize]')!
  const ptr = (type: string, x: number) => act(() => void edge.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, button: 0 }), { pointerId: 1 })))
  const renders = views[7].active.length
  ptr('pointerdown', 800)
  ptr('pointermove', 750)
  ptr('pointermove', 700)
  // Nothing is resized while the edge moves: not the store (the whole ship), not the terminal.
  expect(nexusStore.getState().drawerWidth).toBe(600)
  expect(aside().style.width).toBe('600px')
  expect($('[data-drawer-resize-guide]')?.style.left).toBe('-100px')
  ptr('pointerup', 700)
  expect(nexusStore.getState().drawerWidth).toBe(700)
  expect(localStorage.getItem(WIDTH_KEY)).toBe('700')
  expect(aside().style.width).toBe('700px')
  expect($('[data-drawer-resize-guide]')).toBeNull()
  expect(views[7].active.length).toBe(renders)
  // Never so wide that the ship keeps less than its least.
  ptr('pointerdown', 700)
  ptr('pointermove', 0)
  ptr('pointerup', 0)
  expect(nexusStore.getState().drawerWidth).toBe(1600 - 560)
})

test('a window made narrower keeps the drawer within it, and wider again gives the chosen width back', () => {
  nexusStore.setState({ drawerWidth: 900 })
  const { open } = mount()
  open('cap-1')
  expect(aside().style.width).toBe('900px')
  const resize = (w: number) => act(() => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
    window.dispatchEvent(new Event('resize'))
  })
  resize(1200)
  expect(aside().style.width).toBe(`${1200 - 560}px`)
  resize(1600)
  expect(aside().style.width).toBe('900px')
})

test('a robot’s breadcrumbs name its own repo, not its captain’s deck', async () => {
  const { open } = mount()
  open('r-other')
  await act(settle)
  expect(panel('r-other').querySelector('[data-drawer-crumbs]')?.textContent).toBe('mnemo▸◆ nexus round▸#90')
})

const face = (id: string) => panel(id).dataset.drawerFace
const shows = (id: string) => panel(id).querySelector<HTMLElement>('[data-drawer-conversation]')!.style.visibility
const flip = (id: string, to: 'conversation' | 'terminal') => act(() => panel(id).querySelector<HTMLButtonElement>(`[data-drawer-face-switch] [data-face="${to}"]`)!.click())

test('a new tab opens on its conversation, its live terminal mounted underneath and owning the session', async () => {
  const { open, host } = mount()
  open('cap-1')
  open('r-live')
  await act(settle)
  const attach = host.getState().sessions['child:r-live'].pty!
  for (const [id, pty, session] of [['cap-1', 7, 'cap-1'], ['r-live', attach, 's-live']] as const) {
    expect(face(id)).toBe('conversation')
    expect(shows(id)).toBe('visible')
    expect(panel(id).querySelector(`[data-drawer-terminal] [data-stub-terminal="${pty}"]`)).not.toBeNull()
    expect(convs[session].props).toMatchObject({ sessionId: session, agent: expect.any(Object), onOpenTerminal: expect.any(Function) })
  }
  expect(views[attach].props).toMatchObject({ present: true, name: viewName('r-live'), active: true })
  expect(panel('r-live').querySelector('[data-face="conversation"]')?.getAttribute('aria-pressed')).toBe('true')
  // The conversation has the keyboard.
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement?.hasAttribute('data-composer')).toBe(true)
})

test('the switch flips a tab between its conversation and its terminal, remounting neither, and each tab keeps its own', async () => {
  const { open } = mount()
  open('r-pane')
  open('cap-1')
  await act(settle)
  flip('cap-1', 'terminal')
  expect(face('cap-1')).toBe('terminal')
  expect(shows('cap-1')).toBe('hidden')
  expect(panel('cap-1').querySelector('[data-face="terminal"]')?.getAttribute('aria-pressed')).toBe('true')
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement?.closest('[data-stub-terminal="7"]')).not.toBeNull()
  // Another tab, shown, is on its conversation still; back on this one, the terminal is.
  act(() => nexusStore.getState().activateTab('r-pane'))
  expect(face('r-pane')).toBe('conversation')
  act(() => nexusStore.getState().activateTab('cap-1'))
  expect(face('cap-1')).toBe('terminal')
  flip('cap-1', 'conversation')
  expect(face('cap-1')).toBe('conversation')
  expect(views[7].mounts).toBe(1)
  expect(views[7].active).toEqual([true, false, true])
  expect(convs['cap-1'].mounts).toBe(1)
})

test('⌘⇧C with the Nexus open flips the tab shown, wherever the focus is, and never the pane under the Nexus', async () => {
  const ran: string[] = []
  register({ id: 'pane.toggle-face', title: 'Toggle conversation', run: () => void ran.push('pane.toggle-face') })
  const unclaim = claimFace(nexusStore)
  const { open } = mount()
  open('cap-1')
  open('cap-2')
  await act(settle)
  act(() => nexusStore.getState().activateTab('cap-1'))
  // In the terminal, in the conversation, anywhere a click in the tab put the keyboard, or on the ship.
  act(() => panel('cap-1').querySelector<HTMLElement>('[data-composer]')!.focus())
  act(() => run('pane.toggle-face'))
  expect(face('cap-1')).toBe('terminal')
  act(() => panel('cap-1').querySelector<HTMLElement>('[data-stub-terminal] textarea')!.focus())
  act(() => run('pane.toggle-face'))
  expect(face('cap-1')).toBe('conversation')
  act(() => panel('cap-1').focus())
  act(() => run('pane.toggle-face'))
  expect(face('cap-1')).toBe('terminal')
  const ship = document.body.appendChild(document.createElement('textarea'))
  act(() => ship.focus())
  act(() => run('pane.toggle-face'))
  expect(face('cap-1')).toBe('conversation')
  expect(views[7].mounts).toBe(1)
  expect(convs['cap-1'].mounts).toBe(1)
  // A read-only tab has no terminal: nothing flips.
  act(() => nexusStore.getState().activateTab('cap-2'))
  act(() => run('pane.toggle-face'))
  expect(panel('cap-2').dataset.drawerFace).toBeUndefined()
  expect(panel('cap-2').querySelector('[data-drawer-face-switch]')).toBeNull()
  // Collapsed, nothing flips either.
  act(() => nexusStore.getState().activateTab('cap-1'))
  act(() => nexusStore.getState().setCollapsed(true))
  act(() => run('pane.toggle-face'))
  expect(face('cap-1')).toBe('conversation')
  expect(ran).toEqual([])
  // A popup over the Nexus shows a pane of its own; with the Nexus closed, the chord is the workbench's.
  const popup = document.body.appendChild(document.createElement('div'))
  popup.dataset.popout = ''
  const inPopup = popup.appendChild(document.createElement('textarea'))
  act(() => inPopup.focus())
  act(() => run('pane.toggle-face'))
  act(() => ship.focus())
  act(() => nexusStore.getState().setOpen(false))
  act(() => run('pane.toggle-face'))
  expect(ran).toEqual(['pane.toggle-face', 'pane.toggle-face'])
  unclaim()
})

test('while the attach starts, the conversation says so and has nothing to type into', () => {
  const { open } = mount()
  open('r-live')
  expect(panel('r-live').querySelector('[data-drawer-attaching]')).not.toBeNull()
  expect(convs['s-live'].props.agent).toBeUndefined()
})

test('the conversation’s opener of the terminal shows it; a closed tab opens again on its conversation', async () => {
  const { open, drawer } = mount()
  open('cap-1')
  await act(settle)
  act(() => convs['cap-1'].props.onOpenTerminal!())
  expect(face('cap-1')).toBe('terminal')
  await act(() => drawer.close('cap-1'))
  open('cap-1')
  expect(face('cap-1')).toBe('conversation')
})

test('the composer types into the session’s own PTY: the pane’s, or the child’s attach', async () => {
  const { open, host } = mount()
  open('cap-1')
  open('r-live')
  await act(settle)
  const attach = host.getState().sessions['child:r-live'].pty!
  await act(() => convs['cap-1'].props.agent!.send('ship it'))
  await act(() => convs['s-live'].props.agent!.send('and land'))
  const keys = (pty: number, text: string) => [CLEAR_LINE, BACKSPACE, promptBytes(text) + ENTER].map((k) => `${pty} ${JSON.stringify(k)}`)
  expect(typed).toEqual([...keys(7, 'ship it'), ...keys(attach, 'and land')])
})

test('the conversation is told what the session waits on, so its foot answers it or points at the terminal', async () => {
  const ship = shipFixture()
  const deck = ship.decks[0]
  deck.flight[0] = { ...deck.flight[0], child: { ...deck.flight[0].child, waiting_for: 'permission prompt' } }
  deck.captains[0] = { ...deck.captains[0], parent: { ...deck.captains[0].parent!, status: 'waiting', waiting_for: 'dialog open' } }
  const { open } = mount({ ship })
  open('cap-1')
  open('r-live')
  await act(settle)
  expect(convs['s-live'].props.status).toEqual({ busy: false, waiting: 'permission' })
  expect(convs['cap-1'].props.status).toEqual({ busy: false, waiting: null, parked: true })
})

test('the default width is 42% of the window as it is now; a width dragged and saved wins', () => {
  localStorage.removeItem(WIDTH_KEY)
  expect(readWidth()).toBeNull()
  nexusStore.setState({ drawerWidth: readWidth() })
  const { open } = mount()
  open('cap-1')
  expect(aside().style.width).toBe(`${Math.round(1600 * 0.42)}px`)
  // The app opens at 1280 wide; a window made larger after gets the default of its new width.
  const resize = (w: number) => act(() => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
    window.dispatchEvent(new Event('resize'))
  })
  resize(1280)
  expect(aside().style.width).toBe(`${Math.round(1280 * 0.42)}px`)
  resize(1500)
  expect(aside().style.width).toBe('630px')
  // As in the prototype, never wider than 720 by default.
  resize(2560)
  expect(aside().style.width).toBe('720px')
  localStorage.setItem(WIDTH_KEY, '900')
  expect(readWidth()).toBe(900)
  act(() => nexusStore.setState({ drawerWidth: readWidth() }))
  expect(aside().style.width).toBe('900px')
  // Kept as saved, and fitted to the window only as it is drawn.
  resize(1280)
  expect(aside().style.width).toBe(`${1280 - 560}px`)
  resize(2560)
  expect(aside().style.width).toBe('900px')
  localStorage.removeItem(WIDTH_KEY)
})

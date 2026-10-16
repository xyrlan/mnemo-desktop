import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import type { DiffClient } from '../../diff/client'
import type { PaneViewProps } from '../../panes/registry'
import type { Ship } from '../ship-types'
import { nexusStore } from '../store'
import { NexusDrawer, type DrawerDeps } from './Drawer'
import { fakeHost, reposFixture, settle, shipFixture } from './fixtures'
import { openingOf, OUTSIDE } from './model'
import { createDrawer, viewName } from './sessions'
import { readWidth, WIDTH_KEY } from './width'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const opened = vi.hoisted(() => [] as { id: string; params: unknown }[])
vi.mock('../ui/windows', () => ({ openWindow: (id: string, params: unknown) => void opened.push({ id, params }) }))

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

const diffAsked: string[] = []
const diff: DiffClient = {
  files: async (w) => (diffAsked.push(w), { root: w, truncated: false, files: [{ path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false }] }),
  sides: async () => ({ original: 'one\ntwo', modified: 'one\nTWO', binary: false, tooLarge: false }),
}

let root: Root
function mount(over: { ship?: Ship } = {}) {
  const { host, log } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  const owners = createStore<{ owners: Record<number, { name?: string } | undefined> }>(() => ({ owners: {} }))
  const opened: string[] = []
  const repos: string[] = []
  const deps: DrawerDeps = {
    drawer,
    host,
    owners,
    terminal: StubTerminal,
    conversation: ({ sessionId }) => <div data-stub-conversation={sessionId ?? ''} />,
    diff,
    worktreeOf: (cwd) => cwd,
    goToRepo: (r) => void repos.push(r),
    paneOfSession: () => null,
  }
  const ship = over.ship ?? shipFixture()
  const open = (id: string) => {
    const o = openingOf(id, ship, reposFixture)!
    act(() => drawer.open(o.tab, o.ref))
  }
  const el = document.body.appendChild(document.createElement('div'))
  root = createRoot(el)
  const render = () => act(() => root.render(<NexusDrawer deps={deps} ship={ship} feed={null} repos={reposFixture} onOpen={(id) => void opened.push(id)} />))
  render()
  return { host, log, drawer, owners, open, render, opened, repos }
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const panel = (id: string) => $(`[data-drawer-panel="${id}"]`)!
const aside = () => $('[data-nexus-drawer]')!
/** The drawer's one header: the pills, then the shown session's line. */
const head = () => $('[data-drawer-head]')!
const pills = () => [...document.querySelectorAll<HTMLElement>('[data-drawer-tab]')]
const key = (init: KeyboardEventInit, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

beforeEach(() => {
  for (const k of Object.keys(views)) delete views[Number(k)]
  diffAsked.length = 0
  opened.length = 0
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null, drawerWidth: 600 })
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

test('with no tab nothing is drawn; a pill per session opened, with its state dot and a short name', async () => {
  const { open } = mount()
  expect(aside()).toBeNull()
  open('r-live')
  open('cap-1')
  open('r-live')
  await act(settle)
  const tabs = pills()
  expect(tabs.map((t) => t.textContent)).toEqual(['#682·a', '◆ nexus round'])
  expect(tabs.map((t) => t.getAttribute('role'))).toEqual(['tab', 'tab'])
  expect(tabs[0].querySelector('[role="img"]')?.className).toContain('bg-state-working')
  expect(tabs[0].dataset.tone).toBe('working')
  expect(tabs[1].title).toBe('◆ nexus round · working')
  expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  expect(aside().style.width).toBe('600px')
})

test('the header: breadcrumbs that open the captain, the state, the context size, said once above the panel', async () => {
  const { open, opened } = mount()
  open('r-live')
  await act(settle)
  expect(document.querySelectorAll('[data-drawer-line]')).toHaveLength(1)
  expect(panel('r-live').querySelector('[data-drawer-line], [data-drawer-crumbs], [data-drawer-state]')).toBeNull()
  const p = head()
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

test('× closes the tab and lets its session go', async () => {
  const { open, host } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  await act(async () => $<HTMLButtonElement>('[aria-label="Close nexus round"]')!.click())
  expect(host.getState().sessions['pane:7']).toBeUndefined()
  expect(pills().map((t) => t.textContent)).toEqual(['#682·a'])
})

test('a middle click on a pill closes it; a left click shows it', async () => {
  const { open, host } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  act(() => void pills()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
  expect(nexusStore.getState().activeTab).toBe('r-live')
  await act(async () => void pills()[1].dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })))
  expect(host.getState().sessions['pane:7']).toBeUndefined()
  expect(pills().map((t) => t.dataset.drawerTab)).toEqual(['r-live'])
})

test('← and → move between pills, the keyboard staying on them, not on the terminal', async () => {
  const { open } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  const pill = (id: string) => $(`[data-drawer-tab="${id}"]`)!
  act(() => pill('cap-1').focus())
  key({ key: 'ArrowRight' }, pill('cap-1'))
  expect(nexusStore.getState().activeTab).toBe('r-live')
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement).toBe(pill('r-live'))
  expect(pill('r-live').tabIndex).toBe(0)
  key({ key: 'ArrowLeft' }, pill('r-live'))
  expect(nexusStore.getState().activeTab).toBe('cap-1')
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement).toBe(pill('cap-1'))
  // A click still gives the terminal the keyboard.
  act(() => pill('r-live').click())
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement?.closest('[data-stub-terminal]')).not.toBeNull()
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
  expect(head().querySelector('[data-drawer-crumbs]')?.textContent).toBe('mnemo▸◆ nexus round▸#90')
})

test('a live tab shows its terminal only: no conversation over it, no switch, and the terminal has the keyboard', async () => {
  const { open, host } = mount()
  open('cap-1')
  open('r-live')
  await act(settle)
  const attach = host.getState().sessions['child:r-live'].pty!
  for (const [id, pty] of [['cap-1', 7], ['r-live', attach]] as const) {
    expect(panel(id).querySelector(`[data-drawer-terminal] [data-stub-terminal="${pty}"]`)).not.toBeNull()
    expect(panel(id).querySelector('[data-stub-conversation]')).toBeNull()
    expect(panel(id).querySelector('[data-drawer-face-switch]')).toBeNull()
  }
  expect(views[attach].props).toMatchObject({ present: true, name: viewName('r-live'), active: true })
  await act(() => new Promise((r) => requestAnimationFrame(r)))
  expect(document.activeElement?.closest(`[data-stub-terminal="${attach}"]`)).not.toBeNull()
})

test('a robot’s tab opens its full diff in the Changes window; a captain’s has none', async () => {
  const { open } = mount()
  open('r-live')
  open('cap-1')
  await act(settle)
  expect($('[data-drawer-full-diff]')).toBeNull()
  act(() => nexusStore.getState().activateTab('r-live'))
  act(() => head().querySelector<HTMLButtonElement>('[data-drawer-full-diff]')!.click())
  expect(opened).toEqual([{ id: 'changes', params: { robotId: 'r-live', worktree: '/work/mnemo-desktop-wt-682/src', label: '#682·a' } }])
})

test('a session the Nexus started: named for what it runs until the ship knows it', async () => {
  const { drawer } = mount()
  act(() => drawer.open({ id: 'session:30', kind: 'session', key: null, readOnly: null, label: 'shell · mnemo-desktop', sessionId: null, cwd: '/work/mnemo-desktop' }, { pane: 30 }))
  act(() => drawer.open({ id: 'new-1', kind: 'captain', key: null, readOnly: null, label: 'claude · mnemo-desktop', sessionId: 'new-1', cwd: '/work/mnemo-desktop' }, { pane: 31 }))
  expect(pills().map((t) => t.textContent)).toEqual(['$ mnemo-desktop', 'claude'])
  expect(pills().map((t) => t.title)).toEqual(['shell · mnemo-desktop · /work/mnemo-desktop', 'claude · mnemo-desktop · not on the ship yet'])
  expect(head().querySelector('[data-drawer-line]')?.textContent).toContain('not on the ship yet')
  act(() => nexusStore.getState().activateTab('session:30'))
  expect(head().querySelector('[data-drawer-line]')?.textContent).toContain('/work/mnemo-desktop')
  expect(panel('session:30').querySelector('[data-stub-terminal="30"]')).not.toBeNull()
})

test('nothing in a tab leads to the workbench: no open as tab, and the repo breadcrumb opens a terminal in the drawer', async () => {
  const { open, repos } = mount()
  open('cap-1')
  open('r-live')
  await act(settle)
  for (const id of ['cap-1', 'r-live']) expect(panel(id).querySelector('[data-open-as-tab]')).toBeNull()
  act(() => nexusStore.getState().activateTab('cap-1'))
  expect(head().querySelector('[data-drawer-crumbs]')?.textContent).toBe('mnemo-desktop▸◆ nexus round')
  const crumb = head().querySelector<HTMLButtonElement>('[data-drawer-crumbs] button')!
  expect(crumb.title).toBe('Open a terminal in mnemo-desktop')
  act(() => crumb.click())
  expect(repos).toEqual(['/work/mnemo-desktop'])
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

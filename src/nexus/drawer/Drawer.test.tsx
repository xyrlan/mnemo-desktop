import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import type { DiffClient } from '../../diff/client'
import type { PaneViewProps } from '../../panes/registry'
import { nexusStore } from '../store'
import { NexusDrawer, type DrawerDeps } from './Drawer'
import { fakeHost, reposFixture, settle, shipFixture } from './fixtures'
import { openingOf, OUTSIDE } from './model'
import { createDrawer, viewName } from './sessions'
import { WIDTH_KEY } from './width'
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

const diffAsked: string[] = []
const diff: DiffClient = {
  files: async (w) => (diffAsked.push(w), { root: w, truncated: false, files: [{ path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false }] }),
  sides: async () => ({ original: 'one\ntwo', modified: 'one\nTWO', binary: false, tooLarge: false }),
}

let root: Root
function mount(over: { shown?: boolean } = {}) {
  const { host, log } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
  const owners = createStore<{ owners: Record<number, { name?: string } | undefined> }>(() => ({ owners: {} }))
  const opened: string[] = []
  const deps: DrawerDeps = {
    drawer,
    host,
    owners,
    terminal: StubTerminal,
    conversation: ({ sessionId }) => <div data-stub-conversation={sessionId ?? ''} />,
    diff,
    worktreeOf: (cwd) => cwd,
    goToRepo: () => {},
  }
  const ship = shipFixture()
  const open = (id: string) => {
    const o = openingOf(id, ship, reposFixture)!
    act(() => drawer.open(o.tab, o.ref))
  }
  const el = document.body.appendChild(document.createElement('div'))
  root = createRoot(el)
  const render = (shown = over.shown ?? true) =>
    act(() => root.render(<NexusDrawer deps={deps} ship={ship} feed={null} shown={shown} onOpen={(id) => void opened.push(id)} />))
  render()
  return { host, log, drawer, owners, open, render, opened }
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const panel = (id: string) => $(`[data-drawer-panel="${id}"]`)!
const aside = () => $('[data-nexus-drawer]')!
const key = (init: KeyboardEventInit, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

beforeEach(() => {
  for (const k of Object.keys(views)) delete views[Number(k)]
  diffAsked.length = 0
  nexusStore.setState({ open: true, tabs: [], activeTab: null, collapsed: false, focusId: null, drawerWidth: 600 })
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
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

test('dragging the left edge resizes the drawer, and the width is kept', () => {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  const { open } = mount()
  open('cap-1')
  const edge = $('[data-drawer-resize]')!
  const ptr = (type: string, x: number) => act(() => void edge.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, button: 0 }), { pointerId: 1 })))
  ptr('pointerdown', 800)
  ptr('pointermove', 700)
  expect(nexusStore.getState().drawerWidth).toBe(700)
  ptr('pointerup', 700)
  expect(localStorage.getItem(WIDTH_KEY)).toBe('700')
  expect(aside().style.width).toBe('700px')
  // Never so wide that the ship keeps less than its least.
  ptr('pointerdown', 700)
  ptr('pointermove', 0)
  expect(nexusStore.getState().drawerWidth).toBe(1600 - 560)
})

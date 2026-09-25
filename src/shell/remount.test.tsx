import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../fleet/store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const fleetStore = createStore(() => ({ repos: [] as unknown[], markRead() {}, async refresh() {} }))
  return { fleetStore, useFleet: (sel: (f: unknown) => unknown) => useStore(fleetStore, sel as never) }
})

import Workbench from './Workbench'
import { store } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The terminal view, as far as a remount can tell: xterm draws into a node it made on mount and
// keeps its screen there. A remount makes a new node and loses what was on it.
const life = { mounts: [] as number[], unmounts: [] as number[] }
function Terminal({ id }: PaneViewProps) {
  const screen = useRef<HTMLDivElement>(null)
  useEffect(() => {
    life.mounts.push(id)
    screen.current!.textContent = `screen of ${id}, drawn once on mount`
    return () => void life.unmounts.push(id)
  }, [id])
  return <div className="xterm" data-screen={id} ref={screen} />
}
registerPaneView('terminal', Terminal)

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  life.mounts.length = 0
  life.unmounts.length = 0
  const leaf = (pane: number) => ({ kind: 'leaf' as const, pane })
  const term = (id: number) => ({ id, view: 'terminal', cwd: '/r' })
  // An agent in tab-1, and two more shells, all in one group; tab-2 splits into two terminals.
  store.setState({
    panes: { 1: term(1), 2: term(2), 3: term(3), 4: term(4) },
    tabs: [
      { id: 'tab-1', root: leaf(1), focused: 1 },
      { id: 'tab-2', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [leaf(2), leaf(3)] }, focused: 2 },
      { id: 'tab-4', root: leaf(4), focused: 4 },
    ],
    activeTab: 'tab-1',
    // The app's store outlives each test: no group of the last one may linger.
    groups: {},
    groupRoot: null,
    activeGroup: '',
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<Workbench ready notice={null} onDismissNotice={() => {}} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const screen = (id: number) => host.querySelector<HTMLElement>(`[data-screen="${id}"]`)!
const groupOf = (tab: string) => Object.values(store.getState().groups).find((g) => g.tabs.includes(tab))!.id
const paneOf = (tab: string) => host.querySelector<HTMLElement>(`.pane[data-tab="${tab}"]`)!

test("a terminal's view survives its tab moving across groups, splitting a group and collapsing one", async () => {
  const agent = screen(1)
  expect(agent.textContent).toBe('screen of 1, drawn once on mount')
  expect(life.mounts.sort()).toEqual([1, 2, 3, 4])

  // To a group of its own, on the right: a group splits.
  await act(async () => store.getState().moveTab('tab-1', { group: groupOf('tab-2'), side: 'right' }))
  expect(Object.keys(store.getState().groups)).toHaveLength(2)
  expect(paneOf('tab-1').style.left).toBe('calc(50% + 3px)')
  // Into the other group's row, at its start.
  await act(async () => store.getState().moveTab('tab-4', { group: groupOf('tab-1'), index: 0 }))
  expect(store.getState().groups[groupOf('tab-1')].tabs).toEqual(['tab-4', 'tab-1'])
  // Back, and its old group collapses into the one it joins.
  await act(async () => store.getState().moveTab('tab-1', { group: groupOf('tab-2') }))
  await act(async () => store.getState().moveTab('tab-4', { group: groupOf('tab-2') }))
  expect(Object.keys(store.getState().groups)).toHaveLength(1)
  // A pane of a split terminal tab made a tab of its own, in a new group.
  await act(async () => store.getState().moveTab('tab-1', { group: groupOf('tab-2'), side: 'down' }))
  await act(async () => store.getState().detachPane(3, { group: groupOf('tab-1') }))

  // The same node, never drawn again: nothing was remounted.
  expect(screen(1)).toBe(agent)
  expect(agent.textContent).toBe('screen of 1, drawn once on mount')
  expect(life.mounts.sort()).toEqual([1, 2, 3, 4])
  expect(life.unmounts).toEqual([])
})

test('a tab dragged by its row onto another group keeps its terminal, pane bar and all', async () => {
  await act(async () => store.getState().moveTab('tab-4', { group: groupOf('tab-1'), side: 'right' }))
  const [left, right] = [groupOf('tab-1'), groupOf('tab-4')]
  // jsdom lays nothing out: the two groups side by side on a 1000px workbench, tabs 180px wide.
  const box = (x: number, y: number, w: number, h: number) => DOMRect.fromRect({ x, y, width: w, height: h })
  const at: Record<string, number> = { [left]: 0, [right]: 503 }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const d = (this as HTMLElement).dataset ?? {}
    const g = d.tabGroupId ?? d.tabGroupStripId ?? d.tabGroupBodyId
    if (g && g in at) return d.tabGroupId ? box(at[g], 0, 497, 636) : d.tabGroupStripId ? box(at[g], 0, 497, 36) : box(at[g], 36, 497, 600)
    if (d.tabId) {
      const owner = groupOf(d.tabId)
      return box(at[owner] + store.getState().groups[owner].tabs.indexOf(d.tabId) * 180, 0, 180, 36)
    }
    return box(0, 0, 0, 0)
  })
  const agent = screen(1)
  const bar = agent.closest('.pane')!.querySelector('.pane-bar')
  const pointer = (type: string, target: EventTarget, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(e, 'isPrimary', { value: true })
    act(() => void target.dispatchEvent(e))
  }
  pointer('pointerdown', host.querySelector('[data-tab-id="tab-1"]')!, 90, 18)
  pointer('pointermove', document, 700, 18)
  pointer('pointermove', document, 700, 19)
  pointer('pointerup', document, 700, 19)

  expect(store.getState().groups[right].tabs).toEqual(['tab-4', 'tab-1'])
  expect(screen(1)).toBe(agent)
  expect(agent.closest('.pane')!.querySelector('.pane-bar')).toBe(bar)
  expect(paneOf('tab-1').style.left).toBe('calc(50% + 3px)')
  expect(life.unmounts).toEqual([])
})

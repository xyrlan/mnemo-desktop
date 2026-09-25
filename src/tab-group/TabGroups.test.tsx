import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// The live fleet polls Tauri; the rows only read its repos.
vi.mock('../fleet/store', async () => {
  const { createStore } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const fleetStore = createStore(() => ({ repos: [] as unknown[], markRead() {}, async refresh() {} }))
  return { fleetStore, useFleet: (sel: (f: unknown) => unknown) => useStore(fleetStore, sel as never) }
})

import TabGroups from './TabGroups'
import { createStore, type GroupNode, type Store } from '../layout/store'
import type { PtyClient } from '../pty/client'
import { dragStore } from '../chrome/drag'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pty: PtyClient = { spawn: async () => 1, write: async () => {}, resize: async () => {}, kill: async () => {}, onExit: async () => () => {} }

let host: HTMLDivElement
let root: Root
let s: Store
/** Two groups side by side: `L` holds t1 and t2, `R` holds t3. */
let L: string, R: string
let t1: string, t2: string, t3: string

/** Where each thing is on a 1000×636 workbench (jsdom lays nothing out): L on the left, R on the
 *  right past a 6px seam, each a 36px row over its body, tabs 180px wide. */
function stubLayout() {
  const box = (left: number, top: number, width: number, height: number) => DOMRect.fromRect({ x: left, y: top, width, height })
  const panel = { [L]: box(0, 0, 497, 636), [R]: box(503, 0, 497, 636) }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const d = (this as HTMLElement).dataset ?? {}
    if (this.hasAttribute('data-tab-groups')) return box(0, 0, 1000, 636)
    const g = d.tabGroupId ?? d.tabGroupStripId ?? d.tabGroupBodyId
    if (g && panel[g]) {
      const p = panel[g]
      if (d.tabGroupId) return p
      if (d.tabGroupStripId) return box(p.x, 0, p.width, 36)
      return box(p.x, 36, p.width, 600)
    }
    if (d.tabId) {
      const owner = Object.values(s.getState().groups).find((x) => x.tabs.includes(d.tabId!))!
      return box(panel[owner.id].x + owner.tabs.indexOf(d.tabId) * 180, 0, 180, 36)
    }
    return box(0, 0, 0, 0)
  })
}

beforeEach(async () => {
  dragStore.setState({ from: null, over: null, zone: null, row: null })
  s = createStore(pty)
  for (const name of ['a.md', 'b.md', 'c.md']) s.getState().openView('editor', { root: '/r' }, 'tab', name)
  ;[t1, t2, t3] = s.getState().tabs.map((t) => t.id)
  ;[L] = Object.keys(s.getState().groups)
  s.getState().moveTab(t3, { group: L, side: 'right' })
  R = Object.keys(s.getState().groups).find((g) => g !== L)!
  s.getState().activateTab(t1)
  stubLayout()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<TabGroups layout={s} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const tabEl = (id: string) => host.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!
const panelOf = (g: string) => host.querySelector<HTMLElement>(`[data-tab-group-id="${g}"]`)!
const overlay = () => document.querySelector<HTMLElement>('.tab-drop-overlay')
/** A pointer event as dnd-kit reads it: jsdom has no PointerEvent. */
function pointer(type: string, target: EventTarget, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(e, 'isPrimary', { value: true })
  act(() => void target.dispatchEvent(e))
}
/** Presses tab `id` at its middle and moves to (x, y), past the drag threshold, without letting go. */
function dragTo(id: string, x: number, y: number) {
  const r = tabEl(id).getBoundingClientRect()
  pointer('pointerdown', tabEl(id), r.x + 90, 18)
  pointer('pointermove', document, x - 1, y)
  pointer('pointermove', document, x, y)
}
const release = (x: number, y: number) => pointer('pointerup', document, x, y)
const tabsOf = (g: string) => s.getState().groups[g]?.tabs

test('each group is a row over a body, placed by the split tree, with a seam between them', () => {
  expect([...host.querySelectorAll('[data-tab-group-id]')].map((e) => (e as HTMLElement).dataset.tabGroupId)).toEqual([L, R])
  expect(panelOf(L).style).toMatchObject({ left: '0px', width: 'calc(50% - 3px)', height: '100%' })
  expect(panelOf(R).style).toMatchObject({ left: 'calc(50% + 3px)' })
  expect(panelOf(L).querySelector('.tab-group-row [data-tab-id]')).not.toBeNull()
  expect(panelOf(L).querySelector('[data-tab-group-body-id]')).not.toBeNull()
  expect(host.querySelectorAll('.divider.row')).toHaveLength(1)
})

test('while split, the active group is marked (its row takes the accent) and the others are not', async () => {
  expect(host.querySelector('.tab-groups')!.classList.contains('is-split')).toBe(true)
  expect(panelOf(L).classList.contains('is-active')).toBe(true)
  expect(panelOf(R).classList.contains('is-active')).toBe(false)
  await act(async () => s.getState().focusGroup(R))
  expect(panelOf(R).classList.contains('is-active')).toBe(true)
  // Collapsed to one group, nothing is split.
  await act(async () => s.getState().moveTab(t3, { group: L }))
  expect(host.querySelector('.tab-groups')!.classList.contains('is-split')).toBe(false)
})

test('dragging the seam resizes the groups, held between 15% and 85%', () => {
  const seam = host.querySelector('.divider.row')!
  pointer('pointerdown', seam, 500, 300)
  pointer('pointermove', window, 300, 300)
  expect((s.getState().groupRoot as Extract<GroupNode, { kind: 'split' }>).ratio).toBeCloseTo(0.3)
  pointer('pointermove', window, 10, 300)
  expect((s.getState().groupRoot as Extract<GroupNode, { kind: 'split' }>).ratio).toBe(0.15)
  pointer('pointerup', window, 10, 300)
})

test("a tab dragged onto another group's row lands at the insertion bar, shows there, and that group becomes active", () => {
  // Past the middle of t3: after it.
  dragTo(t1, 650, 18)
  expect(tabEl(t3).className).toContain('after:bg-blue-500')
  expect(overlay()).toBeNull()
  release(650, 18)
  expect(tabsOf(R)).toEqual([t3, t1])
  expect(tabsOf(L)).toEqual([t2])
  expect([s.getState().activeGroup, s.getState().activeTab]).toEqual([R, t1])
  expect(tabEl(t3).className).not.toContain('after:bg-blue-500')
})

test('a tab dragged along its own row reorders it and switches nothing', () => {
  s.getState().activateTab(t2)
  dragTo(t1, 300, 18)
  expect(tabEl(t2).className).toContain('after:bg-blue-500')
  release(300, 18)
  expect(tabsOf(L)).toEqual([t2, t1])
  expect(s.getState().activeTab).toBe(t2)
})

test('onto the outer band of a body, "New split" shades the half a new group takes there; let go, the group is made', () => {
  dragTo(t1, 480, 300)
  const o = overlay()!
  expect(o.dataset.drop).toBe('right')
  expect(o.textContent).toBe('New split')
  expect(o.style).toMatchObject({ left: '248.5px', top: '0px', width: '248.5px', height: '636px' })
  release(480, 300)
  expect(Object.keys(s.getState().groups)).toHaveLength(3)
  expect(tabsOf(L)).toEqual([t2])
  const made = Object.keys(s.getState().groups).find((g) => g !== L && g !== R)!
  expect([s.getState().activeGroup, tabsOf(made)]).toEqual([made, [t1]])
  expect(overlay()).toBeNull()
})

test("onto the middle of another group's body, the tab joins the end of its row; the group it leaves may collapse", () => {
  dragTo(t3, 250, 300)
  expect(overlay()!.dataset.drop).toBe('join')
  expect(overlay()!.textContent).toBe('')
  release(250, 300)
  expect(tabsOf(L)).toEqual([t1, t2, t3])
  expect(s.getState().groups[R]).toBeUndefined()
})

test("a drop that would change nothing shows nothing and does nothing: a group's only tab on its own edge, or its own body", () => {
  const before = s.getState().groupRoot
  dragTo(t3, 520, 300)
  expect(overlay()).toBeNull()
  pointer('pointermove', document, 750, 300)
  expect(overlay()).toBeNull()
  release(750, 300)
  expect(s.getState().groupRoot).toBe(before)
  expect(tabsOf(R)).toEqual([t3])
})

test('Escape, or a release outside every group, drops nothing', () => {
  dragTo(t1, 480, 300)
  expect(overlay()).not.toBeNull()
  act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })))
  expect(overlay()).toBeNull()
  release(480, 300)
  expect(tabsOf(L)).toEqual([t1, t2])

  dragTo(t1, 1200, 300)
  release(1200, 300)
  expect(tabsOf(L)).toEqual([t1, t2])
})

test("a terminal pane's bar dragged over a row shows where it would become a tab", async () => {
  await act(async () => dragStore.setState({ from: 7, over: null, zone: null, row: { group: R, slot: 0 } }))
  expect(tabEl(t3).className).toContain('before:bg-blue-500')
  await act(async () => dragStore.setState({ from: null, over: null, zone: null, row: null }))
  expect(tabEl(t3).className).not.toContain('before:bg-blue-500')
})

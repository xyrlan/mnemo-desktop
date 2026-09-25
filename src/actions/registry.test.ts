import { all, register, run, registerBuiltins, registerProvider } from './registry'
import { createStore } from '../layout/store'
import type { PtyClient } from '../pty/client'

const fake: PtyClient = {
  spawn: async () => 1,
  write: async () => {},
  resize: async () => {},
  kill: async () => {},
  onExit: async () => () => {},
}

test('builtins register and run against the given store', async () => {
  const store = createStore(fake)
  registerBuiltins(store)
  expect(all().map((a) => a.id)).toContain('tab.new')
  run('tab.new')
  await new Promise((r) => setTimeout(r, 0))
  expect(store.getState().tabs).toHaveLength(1)
  run('palette.open')
  expect(store.getState().paletteOpen).toBe(true)
})

test('custom actions extend the registry', () => {
  let hit = 0
  register({ id: 'x', title: 'X', run: () => { hit++ } })
  run('x')
  run('missing')
  expect(hit).toBe(1)
})

test('providers contribute actions at read time and run() sees them', () => {
  let n = 0
  const items = [{ id: 'dyn.1', title: 'Dyn 1', run: () => { n++ } }]
  registerProvider(() => items)
  expect(all().map((a) => a.id)).toContain('dyn.1')
  run('dyn.1')
  expect(n).toBe(1)
  items.length = 0
  expect(all().map((a) => a.id)).not.toContain('dyn.1')
})

test('tab.close closes the active tab and pane.close-others collapses it to the focused pane', async () => {
  let next = 1
  const store = createStore({ ...fake, spawn: async () => next++ })
  registerBuiltins(store)
  // The registry is module-global and an earlier test registered builtins too: take ours.
  const latest = (id: string) => all().filter((a) => a.id === id).at(-1)!.run()
  await store.getState().newTab()
  await store.getState().split('row')
  await store.getState().newTab()
  await latest('tab.close')
  expect(store.getState().tabs).toHaveLength(1)
  await latest('pane.close-others')
  expect(store.getState().tabs[0].root).toEqual({ kind: 'leaf', pane: 2 })
})

test('pane.toggle-face flips the focused terminal between its faces', async () => {
  let next = 1
  const store = createStore({ ...fake, spawn: async () => next++ })
  registerBuiltins(store)
  const latest = (id: string) => all().filter((a) => a.id === id).at(-1)!.run()
  await store.getState().newTab()
  await latest('pane.toggle-face')
  expect(store.getState().panes[1].face).toBe('conversation')
  await latest('pane.toggle-face')
  expect(store.getState().panes[1].face).toBe('terminal')
})

describe('in a workbench of groups', () => {
  let next: number
  let store: ReturnType<typeof createStore>
  const latest = (id: string) => all().filter((a) => a.id === id).at(-1)!.run()
  beforeEach(() => {
    next = 1
    store = createStore({ ...fake, spawn: async () => next++ })
    registerBuiltins(store)
  })

  test('⌘D outside a terminal tab opens a terminal tab in the group to its right', async () => {
    store.getState().openView('vault', {}, 'tab')
    await latest('pane.split.row')
    const [a, b] = Object.values(store.getState().groups)
    expect([a.tabs, b.tabs]).toEqual([['tab--1'], ['tab-1']])
    expect(store.getState().panes[1].view).toBe('terminal')
    expect(store.getState().activeTab).toBe('tab-1')
  })

  test('⌃N and ⌘⇧] count the tabs of the active group', async () => {
    await store.getState().newTab()
    store.getState().openView('vault', {}, 'split-row')
    store.getState().openView('mission', {}, 'tab')
    await latest('tab.go.1')
    expect(store.getState().activeTab).toBe('tab--1')
    await latest('tab.next')
    expect(store.getState().activeTab).toBe('tab--2')
    await latest('tab.next')
    expect(store.getState().activeTab).toBe('tab--1')
  })

  test('⌘⌥→ moves focus to the nearest pane on screen, in another group too, never to one of a hidden tab', async () => {
    await store.getState().newTab()
    await store.getState().newTab()
    store.getState().openView('vault', {}, 'split-row')
    store.getState().focusPane(2)
    // Pane 1's tab is hidden behind pane 2's, and laid out at nothing; the vault is on the right.
    const boxes: Record<number, [number, number, number, number]> = { 1: [0, 0, 0, 0], 2: [0, 0, 500, 400], [-1]: [500, 0, 500, 400] }
    const els = Object.entries(boxes).map(([id, [x, y, w, h]]) => {
      const el = document.createElement('div')
      el.className = 'pane'
      el.dataset.pane = id
      el.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width: w, height: h })
      document.body.appendChild(el)
      return el
    })
    try {
      await latest('focus.right')
      expect([store.getState().activeTab, store.getState().activeGroup]).toEqual(['tab--1', Object.keys(store.getState().groups)[1]])
      await latest('focus.left')
      expect(store.getState().activeTab).toBe('tab-2')
      // Above pane 2 there is only the hidden one, which is nowhere to go.
      await latest('focus.up')
      expect(store.getState().activeTab).toBe('tab-2')
    } finally {
      for (const el of els) el.remove()
    }
  })
})

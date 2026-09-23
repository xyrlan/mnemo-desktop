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

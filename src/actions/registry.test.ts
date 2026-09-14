import { all, register, run, registerBuiltins } from './registry'
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

import { panelOf, panels, registerPanel } from '../registry'
import { register } from './register'

const Nothing = () => null

test('a panel registers before the host has loaded, and the host finds it', async () => {
  // Nothing has imported the host yet in this file: the registry stands without it.
  register({ id: 'learned', title: 'Probe', Component: Nothing })
  expect(panelOf('learned')?.title).toBe('Probe')
  const host = await import('../index')
  // Loading the host loads every panel folder, and the real panel takes the id back.
  expect(host.panels().find((p) => p.id === 'learned')?.title).not.toBe('Probe')
})

test('the host lists the panels in its own order, whatever order they registered in', async () => {
  await import('../index')
  expect(panels().map((p) => p.id)).toEqual(['projects', 'missions', 'changes', 'memory', 'learned', 'accounts', 'setup', 'settings'])
})

test('registering an id again replaces it', () => {
  registerPanel({ id: 'setup', title: 'One', Component: Nothing })
  registerPanel({ id: 'setup', title: 'Two', Component: Nothing })
  expect(panelOf('setup')?.title).toBe('Two')
  expect(panelOf(null)).toBeUndefined()
})

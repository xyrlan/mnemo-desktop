import { closeWindow, openWindow, registerWindow, windowStore, windowsIn } from './windows'

afterEach(() => closeWindow())

test('only a registered window opens, with its params; closing clears it', () => {
  openWindow('nope')
  expect(windowStore.getState().open).toBeNull()
  const off = registerWindow({ id: 'projects', title: 'Projects', render: () => null })
  openWindow('projects', { root: '/r' })
  expect(windowStore.getState().open).toEqual({ id: 'projects', params: { root: '/r' } })
  closeWindow()
  expect(windowStore.getState().open).toBeNull()
  off()
})

test('the SYSTEMS group lists its windows by order', () => {
  const offs = [
    registerWindow({ id: 'settings', title: 'Settings', group: 'systems', order: 50, render: () => null }),
    registerWindow({ id: 'memory', title: 'Memory', group: 'systems', order: 10, render: () => null }),
    registerWindow({ id: 'missions', title: 'Missions', render: () => null }),
  ]
  expect(windowsIn('systems').map((d) => d.id)).toEqual(['memory', 'settings'])
  for (const off of offs) off()
})

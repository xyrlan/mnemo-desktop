import { register, run } from '../../actions/registry'
import { nexusStore } from '../store'
import { fakeHost, reposFixture, shipFixture } from './fixtures'
import { claimClose, isToggleKey } from './keys'
import { openingOf } from './model'
import { createDrawer } from './sessions'
import { confirm } from '../ui/confirm'
import { closeWindow, openWindow, registerWindow, windowStore } from '../ui/windows'

const ran: string[] = []
register({ id: 'pane.close', title: 'Close pane', run: () => void ran.push('pane.close') })
register({ id: 'tab.close', title: 'Close tab', run: () => void ran.push('tab.close') })

beforeEach(() => {
  ran.length = 0
  document.body.innerHTML = ''
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
})

function setup() {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  for (const id of ['cap-1', 'r-pane']) {
    const o = openingOf(id, shipFixture(), reposFixture)!
    drawer.open(o.tab, o.ref)
  }
  const unclaim = claimClose(drawer, nexusStore)
  const root = document.body.appendChild(document.createElement('div'))
  root.dataset.nexusDrawer = ''
  const inside = root.appendChild(document.createElement('textarea'))
  const outside = document.body.appendChild(document.createElement('textarea'))
  return { host, unclaim, inside, outside }
}

test('⌘W and ⇧⌘W close the drawer’s tab shown, wherever the focus is', () => {
  const { host, unclaim, inside, outside } = setup()
  inside.focus()
  run('pane.close')
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['cap-1'])
  expect(host.getState().sessions['pane:9']).toBeUndefined()
  // On the ship, the quick diff, or nowhere at all.
  outside.focus()
  run('tab.close')
  expect(nexusStore.getState().tabs).toEqual([])
  expect(ran).toEqual([])
  unclaim()
})

test('with the drawer collapsed or empty, they close nothing: never a pane no tab shows', () => {
  const { unclaim, outside } = setup()
  outside.focus()
  nexusStore.getState().setCollapsed(true)
  run('pane.close')
  run('tab.close')
  expect(nexusStore.getState().tabs).toHaveLength(2)
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false })
  run('pane.close')
  expect(ran).toEqual([])
  unclaim()
})

test('⌘\\ on a Mac, Ctrl+Shift+\\ elsewhere: plain Ctrl+\\ is the shell’s', () => {
  const k = (over: Partial<KeyboardEvent>) => ({ key: '\\', code: 'Backslash', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })
  expect(isToggleKey(k({ metaKey: true }), 'mac')).toBe(true)
  expect(isToggleKey(k({ ctrlKey: true }), 'mac')).toBe(false)
  expect(isToggleKey(k({ ctrlKey: true, shiftKey: true, key: '|' }), 'other')).toBe(true)
  expect(isToggleKey(k({ ctrlKey: true }), 'other')).toBe(false)
})

test('with a window open, ⌘W closes the window, not the drawer’s tab under it; a confirmation goes first', async () => {
  const { unclaim, inside } = setup()
  const unregister = registerWindow({ id: 'zz-test', title: 'Test', render: () => null })
  openWindow('zz-test')
  inside.focus()
  const asked = confirm({ title: 'Close it?', confirm: 'Close' })
  run('pane.close')
  expect(await asked).toBe(false)
  expect(windowStore.getState().open?.id).toBe('zz-test')
  run('tab.close')
  expect(windowStore.getState().open).toBeNull()
  expect(nexusStore.getState().tabs).toHaveLength(2)
  expect(ran).toEqual([])
  closeWindow()
  unregister()
  unclaim()
})

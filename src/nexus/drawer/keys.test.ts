import { register, run } from '../../actions/registry'
import { nexusStore } from '../store'
import { fakeHost, reposFixture, shipFixture } from './fixtures'
import { claimClose, isToggleKey } from './keys'
import { openingOf } from './model'
import { createDrawer } from './sessions'

const ran: string[] = []
register({ id: 'pane.close', title: 'Close pane', run: () => void ran.push('pane.close') })

beforeEach(() => {
  ran.length = 0
  document.body.innerHTML = ''
  nexusStore.setState({ open: true, tabs: [], activeTab: null, collapsed: false, focusId: null })
})

function setup() {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, { goToPane: () => {}, attach: () => {}, closeNexus: () => {} })
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

test('⌘W with the drawer focused closes its tab shown, not the workbench’s pane', () => {
  const { host, unclaim, inside } = setup()
  inside.focus()
  run('pane.close')
  expect(ran).toEqual([])
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['cap-1'])
  expect(host.getState().sessions['pane:9']).toBeUndefined()
  unclaim()
})

test('⌘W elsewhere, or with the drawer collapsed, closes the pane as ever', () => {
  const { unclaim, inside, outside } = setup()
  outside.focus()
  run('pane.close')
  inside.focus()
  nexusStore.getState().setCollapsed(true)
  run('pane.close')
  expect(ran).toEqual(['pane.close', 'pane.close'])
  expect(nexusStore.getState().tabs).toHaveLength(2)
  unclaim()
})

test('⌘\\ on a Mac, Ctrl+Shift+\\ elsewhere: plain Ctrl+\\ is the shell’s', () => {
  const k = (over: Partial<KeyboardEvent>) => ({ key: '\\', code: 'Backslash', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })
  expect(isToggleKey(k({ metaKey: true }), 'mac')).toBe(true)
  expect(isToggleKey(k({ ctrlKey: true }), 'mac')).toBe(false)
  expect(isToggleKey(k({ ctrlKey: true, shiftKey: true, key: '|' }), 'other')).toBe(true)
  expect(isToggleKey(k({ ctrlKey: true }), 'other')).toBe(false)
})

import { DETACH_KEY } from '../../cockpit/prompt'
import { nexusStore } from '../store'
import { fakeHost, reposFixture, settle, shipFixture } from './fixtures'
import { CHILD_ENDED, ENDED, OUTSIDE, openingOf } from './model'
import { BY, createDrawer, type Release } from './sessions'

function setup() {
  const { host, log, exits } = fakeHost()
  const done: string[] = []
  const release: Release = { letGo: (pane) => void done.push(`let go ${pane}`) }
  const drawer = createDrawer(host, nexusStore, release)
  const ship = shipFixture()
  const open = (id: string) => {
    const o = openingOf(id, ship, reposFixture)
    if (!o) throw new Error(`no figure ${id}`)
    drawer.open(o.tab, o.ref)
  }
  return { host, log, exits, done, drawer, open }
}

beforeEach(() => nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null }))

test('opening the same figure twice gives one tab, one hold and one attach', async () => {
  const { host, log, open } = setup()
  open('r-live')
  open('r-live')
  await settle()
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['r-live'])
  expect(Object.values(host.getState().sessions)).toEqual([expect.objectContaining({ key: 'child:r-live', kind: 'attach', pty: 60, by: [BY] })])
  expect(log.filter((l) => l.startsWith('spawn'))).toEqual(['spawn 60'])
})

test('a figure with a tab already is shown, the tab not opened again', () => {
  const { open } = setup()
  open('r-live')
  open('cap-1')
  expect(nexusStore.getState().activeTab).toBe('cap-1')
  open('r-live')
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['r-live', 'cap-1'])
  expect(nexusStore.getState().activeTab).toBe('r-live')
})

test('a robot is held by its attach, a captain and a robot in a pane by the pane', () => {
  const { host, open } = setup()
  open('r-live')
  open('r-pane')
  open('cap-1')
  const s = host.getState().sessions
  expect(Object.keys(s).sort()).toEqual(['child:r-live', 'pane:7', 'pane:9'])
  expect(s['pane:7']).toMatchObject({ kind: 'pane', pty: 7 })
})

test('closing a tab releases its hold: the attach is detached and its PTY ended, the child left running', async () => {
  const { host, log, drawer, open } = setup()
  open('r-live')
  open('cap-1')
  await settle()
  await drawer.close('r-live')
  expect(host.getState().sessions['child:r-live']).toBeUndefined()
  expect(log).toContain(`write 60 ${JSON.stringify(DETACH_KEY)}`)
  expect(log).toContain('kill 60')
  expect(log.some((l) => l.includes('claude stop'))).toBe(false)
  await drawer.close('cap-1')
  expect(host.getState().sessions).toEqual({})
  expect(nexusStore.getState().tabs).toEqual([])
})

test('closing the tab shown shows the one opened last', async () => {
  const { drawer, open } = setup()
  open('r-live')
  open('cap-1')
  open('r-pane')
  nexusStore.getState().activateTab('cap-1')
  await drawer.close('cap-1')
  expect(nexusStore.getState().activeTab).toBe('r-pane')
})

test('a captain alive outside the app gets its conversation read-only, and no process is started', async () => {
  const { host, log, open } = setup()
  open('cap-2')
  await settle()
  expect(nexusStore.getState().tabs).toEqual([expect.objectContaining({ id: 'cap-2', key: null, readOnly: OUTSIDE, sessionId: 'cap-2' })])
  expect(host.getState().sessions).toEqual({})
  expect(log).toEqual([])
})

test('an ended captain or child is shown read-only too; the empty chair opens nothing', () => {
  const ship = shipFixture()
  expect(openingOf('cap-3', ship, reposFixture)).toMatchObject({ ref: null, tab: { readOnly: ENDED } })
  expect(openingOf('r-done', ship, reposFixture)).toMatchObject({ ref: null, tab: { readOnly: CHILD_ENDED } })
  expect(openingOf('orphan:/work/mnemo', ship, reposFixture)).toBeNull()
  expect(openingOf('nobody', ship, reposFixture)).toBeNull()
})

test('a read-only tab takes the live session once it has a pane', () => {
  const { host, drawer } = setup()
  const o = openingOf('cap-2', shipFixture(), reposFixture)!
  drawer.open(o.tab, o.ref)
  drawer.open(o.tab, { pane: 12 })
  expect(nexusStore.getState().tabs).toEqual([expect.objectContaining({ id: 'cap-2', key: 'pane:12', readOnly: null })])
  expect(host.getState().sessions['pane:12']?.by).toEqual([BY])
})

test('collapse keeps every hold, and the tabs', async () => {
  const { host, log, drawer, open } = setup()
  open('r-live')
  open('cap-1')
  await settle()
  drawer.toggle()
  expect(nexusStore.getState().collapsed).toBe(true)
  expect(Object.keys(host.getState().sessions).sort()).toEqual(['child:r-live', 'pane:7'])
  expect(log).not.toContain('kill 60')
  expect(nexusStore.getState().tabs).toHaveLength(2)
  drawer.toggle()
  expect(nexusStore.getState().collapsed).toBe(false)
})

test('focusId follows the tab shown, clears while collapsed and comes back on expand', async () => {
  const { drawer, open } = setup()
  open('r-live')
  expect(nexusStore.getState().focusId).toBe('r-live')
  open('cap-1')
  expect(nexusStore.getState().focusId).toBe('cap-1')
  nexusStore.getState().activateTab('r-live')
  expect(nexusStore.getState().focusId).toBe('r-live')
  drawer.toggle()
  expect(nexusStore.getState().focusId).toBeNull()
  drawer.toggle()
  expect(nexusStore.getState().focusId).toBe('r-live')
  // Opening a figure while collapsed expands the drawer onto it.
  drawer.toggle()
  open('r-pane')
  expect(nexusStore.getState()).toMatchObject({ collapsed: false, focusId: 'r-pane' })
  await drawer.close('r-pane')
  await drawer.close('r-live')
  await drawer.close('cap-1')
  expect(nexusStore.getState()).toMatchObject({ focusId: null, activeTab: null, collapsed: false })
})

test('with no tab the drawer does not collapse', () => {
  const { drawer } = setup()
  drawer.toggle()
  expect(nexusStore.getState().collapsed).toBe(false)
})

test('a session the host lets go of (its pane closed, its attach ended) takes its tab', async () => {
  const { host, exits, open } = setup()
  open('cap-1')
  open('r-live')
  await settle()
  host.getState().paneGone(7)
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['r-live'])
  exits[60](0)
  expect(nexusStore.getState().tabs).toEqual([])
})


test('closing the last tab that shows a pane hands the pane to letGo; an attach is only ended', async () => {
  const { done, drawer, open, log } = setup()
  open('cap-1')
  open('r-live')
  await settle()
  await drawer.close('cap-1')
  await drawer.close('r-live')
  expect(done).toEqual(['let go 7'])
  expect(log).toContain('kill 60')
})

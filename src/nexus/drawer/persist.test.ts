import type { Pane } from '../../layout/store'
import { nexusStore, type DrawerTab } from '../store'
import { fakeHost } from './fixtures'
import { adoptPanes, adoptShells, lostPanes, readTabs, reopenTabs, TABS_KEY, tabsToSave, writeTabs } from './persist'
import { createDrawer } from './sessions'

const tab = (over: Partial<DrawerTab>): DrawerTab => ({ id: 'x', kind: 'captain', key: null, readOnly: null, label: 'x', sessionId: null, cwd: '/work/mnemo', ...over })
const term = (id: number, over: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', ...over })

function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

beforeEach(() => {
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
})

test('kept: each tab on a pane, with the tab shown; an attach or a read-only tab is not', () => {
  const saved = tabsToSave({
    tabs: [
      tab({ id: 'cap-1', key: 'pane:7', sessionId: 'cap-1', label: 'round' }),
      tab({ id: 'r-live', kind: 'robot', key: 'child:r-live' }),
      tab({ id: 'cap-2', key: null, readOnly: 'outside' }),
      tab({ id: 'session:9', kind: 'session', key: 'pane:9', label: 'shell · mnemo' }),
    ],
    activeTab: 'session:9',
  })
  expect(saved).toEqual({
    tabs: [
      { id: 'cap-1', kind: 'captain', label: 'round', sessionId: 'cap-1', cwd: '/work/mnemo', pane: 7 },
      { id: 'session:9', kind: 'session', label: 'shell · mnemo', sessionId: null, cwd: '/work/mnemo', pane: 9 },
    ],
    active: 'session:9',
  })
  expect(tabsToSave({ tabs: [tab({ id: 'r', key: 'child:r' })], activeTab: 'r' }).active).toBeNull()
})

test('read back as written; what cannot be read is left out', () => {
  const s = memory()
  const saved = { tabs: [{ id: 'cap-1', kind: 'captain' as const, label: 'round', sessionId: 'cap-1', cwd: '/w', pane: 7 }], active: 'cap-1' }
  writeTabs(s, saved)
  expect(readTabs(s)).toEqual(saved)
  s.setItem(TABS_KEY, JSON.stringify({ tabs: [{ id: 'a', kind: 'alien', pane: 1 }, { id: 'b', kind: 'robot', pane: 0 }, { kind: 'captain', pane: 2 }, 7, { id: 'c', kind: 'session', pane: 3 }] }))
  expect(readTabs(s)).toEqual({ tabs: [{ id: 'c', kind: 'session', label: 'c', sessionId: null, cwd: null, pane: 3 }], active: null })
  s.setItem(TABS_KEY, '{not json')
  expect(readTabs(s)).toEqual({ tabs: [], active: null })
  expect(readTabs(null)).toEqual({ tabs: [], active: null })
})

test('after a restart each tab comes back on its pane, or on the pane that resumed its session; the rest are forgotten', () => {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  const panes: Record<number, Pane> = { 7: term(7, { sessionId: 'cap-1' }), 9: term(9, { offscreen: true }), 12: term(12, { offscreen: true, sessionId: 'sess-3' }), 13: term(13, { exitCode: 0 }) }
  reopenTabs(
    {
      tabs: [
        { id: 'cap-1', kind: 'captain', label: 'round', sessionId: 'cap-1', cwd: '/w', pane: 7 },
        { id: 'session:9', kind: 'session', label: 'shell · w', sessionId: null, cwd: '/w', pane: 9 },
        { id: 'sess-3', kind: 'captain', label: 'claude · w', sessionId: 'sess-3', cwd: '/w', pane: 3 },
        { id: 'session:4', kind: 'session', label: 'gone', sessionId: null, cwd: '/w', pane: 4 },
        { id: 'session:13', kind: 'session', label: 'exited', sessionId: null, cwd: '/w', pane: 13 },
      ],
      active: 'session:9',
    },
    panes,
    drawer,
    nexusStore,
  )
  expect(nexusStore.getState().tabs.map((t) => [t.id, t.key])).toEqual([
    ['cap-1', 'pane:7'],
    ['session:9', 'pane:9'],
    ['sess-3', 'pane:12'],
  ])
  expect(nexusStore.getState().activeTab).toBe('session:9')
  expect(Object.keys(host.getState().sessions)).toEqual(['pane:7', 'pane:9', 'pane:12'])
})

test('a shell the restore brought back that no tab shows gets a tab of its own, offscreen or not; Claude, exited and shown panes do not (#459)', () => {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  const panes: Record<number, Pane> = {
    // A workbench tab's shell from before the Nexus was the app, and one with a title of its own.
    3: term(3, { cwd: '/work/mnemo-desktop', offscreen: true }),
    4: term(4, { cwd: '/work/notes', title: 'vim todo.md', offscreen: true }),
    // Its captain opens it: it holds a Claude session (the launch's `check` asks what runs there).
    5: term(5, { cwd: '/work/mnemo', sessionId: 'cap-5', offscreen: true }),
    6: term(6, { cwd: '/w' }),
    7: term(7, { cwd: '/w', exitCode: 0 }),
    8: term(8, { cwd: '/w', offscreen: true }),
    9: { id: 9, view: 'vault' },
  }
  reopenTabs({ tabs: [{ id: 'session:8', kind: 'session', label: 'shell · w', sessionId: null, cwd: '/w', pane: 8 }], active: 'session:8' }, panes, drawer, nexusStore)
  adoptShells(panes, drawer, nexusStore)
  expect(nexusStore.getState().tabs.map((t) => [t.id, t.kind, t.key, t.label, t.cwd])).toEqual([
    ['session:8', 'session', 'pane:8', 'shell · w', '/w'],
    ['session:3', 'session', 'pane:3', 'shell · mnemo-desktop', '/work/mnemo-desktop'],
    ['session:4', 'session', 'pane:4', 'vim todo.md', '/work/notes'],
    ['session:6', 'session', 'pane:6', 'shell · w', '/w'],
  ])
  // The tab kept as shown stays shown.
  expect(nexusStore.getState().activeTab).toBe('session:8')
  // A second pass opens nothing twice.
  adoptShells(panes, drawer, nexusStore)
  expect(nexusStore.getState().tabs).toHaveLength(4)
})

test('with no tab kept, the last shell adopted is shown', () => {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  adoptShells({ 1: term(1, { cwd: '/a' }), 2: term(2, { cwd: '/b' }) }, drawer, nexusStore)
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'session:2', collapsed: false })
})

test('a pane that holds a Claude session id but runs none gets a tab, quietly; one a tab shows already gets no second (#460)', () => {
  const { host } = fakeHost()
  const drawer = createDrawer(host, nexusStore, {})
  const panes: Record<number, Pane> = {
    2: term(2, { cwd: '/w/b', sessionId: 'stale', offscreen: true }),
    3: term(3, { cwd: '/w/c', sessionId: 'unknown', offscreen: true, title: 'vim' }),
    4: term(4, { cwd: '/w/d', sessionId: 'shown', offscreen: true }),
  }
  drawer.open({ id: 'shown', kind: 'captain', key: null, readOnly: null, label: 'd', sessionId: 'shown', cwd: '/w/d' }, { pane: 4 })
  nexusStore.getState().setCollapsed(true)
  adoptPanes(Object.values(panes), drawer, nexusStore)
  expect(nexusStore.getState().tabs.map((t) => [t.id, t.key, t.label])).toEqual([
    ['shown', 'pane:4', 'd'],
    ['session:2', 'pane:2', 'shell · b'],
    ['session:3', 'pane:3', 'vim'],
  ])
  // Quietly: the drawer stays collapsed on the tab it showed.
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'shown', collapsed: true })
  // The ids stay with the panes, for a later launch to resume.
  expect([panes[2].sessionId, panes[3].sessionId]).toEqual(['stale', 'unknown'])
})

test('the panes whose Claude session went are those that held an id and hold none now', () => {
  const before: Record<number, Pane> = { 1: term(1, { sessionId: 's-1' }), 2: term(2, { sessionId: 's-2' }), 3: term(3) }
  expect(lostPanes(before, before)).toEqual([])
  expect(lostPanes(before, { 1: term(1), 2: term(2, { sessionId: 'other' }), 3: term(3) })).toEqual([1])
})

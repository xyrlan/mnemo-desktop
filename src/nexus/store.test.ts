import type { LogEvent } from './ship-types'
import { LOG_MAX, nexusStore, type DrawerTab } from './store'

const ev = (id: string): LogEvent => ({ id, at: 1, kind: 'dispatched', robotId: id, captainId: null, text: '' })

beforeEach(() => nexusStore.setState({ log: [], selection: new Set() }))

test('the log skips a milestone it already holds and keeps the newest LOG_MAX', () => {
  const s = nexusStore.getState()
  s.appendLog([ev('a'), ev('b')])
  s.appendLog([ev('b'), ev('c'), ev('c')])
  expect(nexusStore.getState().log.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  s.appendLog(Array.from({ length: LOG_MAX }, (_, i) => ev(`n${i}`)))
  expect(nexusStore.getState().log).toHaveLength(LOG_MAX)
  expect(nexusStore.getState().log[0].id).toBe('n0')
})

test('shift+click toggles a robot in and out of the selection', () => {
  const s = nexusStore.getState()
  s.toggleSelect('a')
  s.toggleSelect('b')
  s.toggleSelect('a')
  expect([...nexusStore.getState().selection]).toEqual(['b'])
  s.clearSelection()
  expect(nexusStore.getState().selection.size).toBe(0)
})

test('triage asked from outside opens the Nexus; the view settles it, on triage only with robots waiting', () => {
  nexusStore.setState({ open: false, triage: false, triageAsked: false })
  nexusStore.getState().askTriage()
  expect(nexusStore.getState()).toMatchObject({ open: true, triage: false, triageAsked: true })
  nexusStore.getState().settleTriageAsk(0)
  expect(nexusStore.getState()).toMatchObject({ triage: false, triageAsked: false })
  nexusStore.getState().askTriage()
  nexusStore.getState().settleTriageAsk(2)
  expect(nexusStore.getState()).toMatchObject({ triage: true, triageAsked: false })
})

test('a tab retargeted keeps its place and, shown, stays shown; onto a tab open already, it only goes', () => {
  const tab = (id: string, over: Partial<DrawerTab> = {}): DrawerTab => ({ id, kind: 'session', key: `pane:${id.length}`, readOnly: null, label: id, sessionId: null, cwd: null, ...over })
  nexusStore.setState({ tabs: [tab('a'), tab('bb'), tab('ccc')], activeTab: 'bb', collapsed: false, focusId: 'bb' })
  nexusStore.getState().retargetTab('bb', tab('s-1', { kind: 'captain', sessionId: 's-1' }))
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['a', 's-1', 'ccc'])
  expect(nexusStore.getState()).toMatchObject({ activeTab: 's-1', focusId: 's-1' })
  nexusStore.getState().retargetTab('a', tab('ccc'))
  expect(nexusStore.getState().tabs.map((t) => t.id)).toEqual(['s-1', 'ccc'])
  expect(nexusStore.getState().activeTab).toBe('s-1')
  nexusStore.getState().retargetTab('s-1', tab('ccc'))
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'ccc', focusId: 'ccc' })
  // Collapsed, nothing is highlighted; an id not open changes nothing.
  nexusStore.setState({ tabs: [tab('a')], activeTab: 'a', collapsed: true, focusId: null })
  nexusStore.getState().retargetTab('a', tab('b'))
  expect(nexusStore.getState()).toMatchObject({ activeTab: 'b', focusId: null, collapsed: true })
  const before = nexusStore.getState().tabs
  nexusStore.getState().retargetTab('zzz', tab('q'))
  expect(nexusStore.getState().tabs).toBe(before)
})

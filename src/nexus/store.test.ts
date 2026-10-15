import type { LogEvent } from './ship-types'
import { LOG_MAX, nexusStore } from './store'

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

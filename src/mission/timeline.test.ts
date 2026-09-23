import { statusMarkers } from './timeline'
import type { TimelineLine } from './types'

const line = (at: string, state: string, detail: string): TimelineLine => ({ at, state, detail, text: '' })

test('one marker per state change: repeated polls of the same state + detail collapse into the first', () => {
  const lines = [
    line('2026-09-15T17:10:00Z', 'working', 'building'),
    line('2026-09-15T17:11:00Z', 'working', 'Running git log --oneline'),
    line('2026-09-15T17:12:00Z', 'working', 'Reading src/mission/view.tsx'),
    line('2026-09-15T17:23:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:24:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:26:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:27:00Z', 'blocked', 'awaiting task specification'),
    line('2026-09-15T17:28:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:40:00Z', 'done', ''),
    line('2026-09-15T17:41:00Z', 'done', ''),
  ]
  expect(statusMarkers(lines)).toEqual([
    { at: '2026-09-15T17:10:00Z', label: 'working' },
    { at: '2026-09-15T17:23:00Z', label: 'blocked · awaiting task clarification' },
    { at: '2026-09-15T17:27:00Z', label: 'blocked · awaiting task specification' },
    { at: '2026-09-15T17:28:00Z', label: 'blocked · awaiting task clarification' },
    { at: '2026-09-15T17:40:00Z', label: 'done' },
  ])
})

test('a line without a timestamp keeps its place by taking the time of the line before it', () => {
  const lines = [line('2026-09-15T17:10:00Z', 'working', 'a'), line('', 'blocked', 'b'), line('2026-09-15T17:30:00Z', 'working', 'c')]
  expect(statusMarkers(lines).map((m) => m.at)).toEqual(['2026-09-15T17:10:00Z', '2026-09-15T17:10:00Z', '2026-09-15T17:30:00Z'])
})

test('no lines, no markers', () => {
  expect(statusMarkers([])).toEqual([])
})

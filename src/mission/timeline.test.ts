import { timelineRows } from './timeline'
import type { TimelineLine } from './types'

const line = (at: string, state: string, detail: string): TimelineLine => ({ at, state, detail, text: '' })
const ms = (iso: string) => Date.parse(iso)

test('consecutive identical state + detail fold into one row with its count and span', () => {
  const lines = [
    line('2026-09-15T17:10:00Z', 'working', 'building'),
    line('2026-09-15T17:23:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:24:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:26:00Z', 'blocked', 'awaiting task clarification'),
    line('2026-09-15T17:27:00Z', 'blocked', 'awaiting task specification'),
    line('2026-09-15T17:28:00Z', 'blocked', 'awaiting task clarification'),
  ]
  const rows = timelineRows(lines, [], undefined)
  expect(rows.map((r) => (r.kind === 'status' ? `${r.detail} ×${r.lines.length}` : 'you'))).toEqual([
    'building ×1',
    'awaiting task clarification ×3',
    'awaiting task specification ×1',
    'awaiting task clarification ×1',
  ])
  const run = rows[1]
  expect(run.kind === 'status' && [run.first, run.last]).toEqual([ms('2026-09-15T17:23:00Z'), ms('2026-09-15T17:26:00Z')])
  expect(run.kind === 'status' && run.lines.map((l) => l.index)).toEqual([1, 2, 3])
})

test('a reply sent from the app sits at its time among the status lines, and splits a run', () => {
  const lines = [
    line('2026-09-15T17:10:00Z', 'blocked', 'awaiting task'),
    line('2026-09-15T17:20:00Z', 'blocked', 'awaiting task'),
    line('2026-09-15T17:30:00Z', 'working', 'building'),
  ]
  const sent = [{ at: ms('2026-09-15T17:16:42Z'), text: 'go ahead', original: 'go ahead' }]
  const rows = timelineRows(lines, sent, undefined)
  expect(rows.map((r) => (r.kind === 'you' ? `you ${r.sent.text}` : `${r.detail} ×${r.lines.length}`))).toEqual([
    'awaiting task ×1',
    'you go ahead',
    'awaiting task ×1',
    'building ×1',
  ])
})

test('a line without a timestamp keeps its place in the file', () => {
  const lines = [line('2026-09-15T17:10:00Z', 'working', 'a'), line('', 'working', 'b'), line('2026-09-15T17:30:00Z', 'working', 'c')]
  const sent = [{ at: ms('2026-09-15T17:20:00Z'), text: 'x', original: 'x' }]
  const rows = timelineRows(lines, sent, undefined)
  expect(rows.map((r) => (r.kind === 'you' ? 'you' : r.detail))).toEqual(['a', 'b', 'you', 'c'])
})

test('a run is fresh when any of its lines is past what the user had seen', () => {
  const lines = [line('2026-09-15T17:10:00Z', 'w', 'a'), line('2026-09-15T17:11:00Z', 'w', 'a'), line('2026-09-15T17:12:00Z', 'w', 'b')]
  expect(timelineRows(lines, [], 1).map((r) => r.kind === 'status' && r.fresh)).toEqual([true, true])
  expect(timelineRows(lines, [], 3).map((r) => r.kind === 'status' && r.fresh)).toEqual([false, false])
  expect(timelineRows(lines, [], undefined).map((r) => r.kind === 'status' && r.fresh)).toEqual([false, false])
})

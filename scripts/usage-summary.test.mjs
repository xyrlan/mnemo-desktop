import { parseRows, report, summarize } from './usage-summary.mjs'

const rows = [
  { event: 'beat', face: 'terminal', ts: 100 },
  { event: 'beat', face: 'terminal', ts: 200 },
  { event: 'beat', face: 'conversation', ts: 300 },
  { event: 'beat', face: 'terminal', ts: 400 },
  { event: 'face', face: 'conversation', session: true, ts: 250 },
  { event: 'face', face: 'terminal', session: false, ts: 350 },
  { event: 'face', face: 'conversation', session: true, ts: 50 },
  { event: 'beat', face: 'conversation', ts: 10 },
]

test('beats split by face and face changes count from the window start on', () => {
  const s = summarize(rows, 100)
  expect(s.beats).toEqual({ terminal: 3, conversation: 1 })
  expect(s.total).toBe(4)
  expect(s.share).toBe(0.25)
  expect(s.toggles).toEqual({ terminal: 1, conversation: 1, withSession: 1, total: 2 })
})

test('rows without a stamp or a known face, and nothing at all, count as nothing', () => {
  const s = summarize([{ event: 'beat', face: 'terminal' }, { event: 'beat', face: 'other', ts: 5 }, { event: 'mystery', face: 'terminal', ts: 5 }], 0)
  expect(s.total).toBe(0)
  expect(s.share).toBeNull()
  expect(s.toggles.total).toBe(0)
})

test('a torn or foreign line is skipped, not fatal', () => {
  expect(parseRows('{"event":"beat","face":"terminal","ts":1}\n{"event":"be\n[1]\n\n')).toEqual([{ event: 'beat', face: 'terminal', ts: 1 }])
})

test('the report names the share and where it stands against the spec bar', () => {
  const text = report(summarize(rows, 100), 7)
  expect(text).toContain('last 7 days')
  expect(text).toContain('conversation face: 25% (1)')
  expect(text).toContain('terminal face: 75% (3)')
  expect(text).toContain("under the spec's 30% bar")
  expect(text).toContain('face toggles: 2 (1 to conversation, 1 to terminal; 1 with a Claude session)')
  expect(report(summarize([], 0), 1)).toContain('no beats yet')
})

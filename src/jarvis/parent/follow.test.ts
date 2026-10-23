import type { TranscriptRecord } from '../../conversation/types'
import { transcript } from './fixtures'
import { readTurn, ROW_LAG_MS, sentence, STARTING, step, type Row, type Said, type Track } from './follow'

const HANDED: Track = { ...STARTING, handedOff: true, state: 'working' }

/** `step` over a run of reads, each a transcript and a row read at `rowAt`: the last track and
 *  everything said on the way. */
function run(reads: { records: TranscriptRecord[]; row: Row | null; rowAt?: number | null; exited?: boolean }[], from: Track = HANDED) {
  let track = from
  const said: Said[] = []
  for (const r of reads) {
    const next = step(track, { row: r.row, rowAt: r.rowAt ?? null, turn: readTurn(r.records), exited: r.exited ?? false })
    track = next.track
    said.push(...next.said)
  }
  return { track, said }
}

test('readTurn reads the turn the last prompt started: what the parent said last, the call it waits on, its end', () => {
  const t = transcript()
  const records = [
    t.prompt('p1', 'first request'),
    t.said('a1', 'An answer to the first.'),
    t.end('e1'),
    t.prompt('p2', 'second request'),
    t.said('a2', 'Looking at the tests.'),
    t.tool('a3', 'tu1', 'Bash', { command: 'pnpm test' }),
  ]
  expect(readTurn(records)).toMatchObject({
    promptId: 'p2',
    start: 3,
    text: 'Looking at the tests.',
    textId: 'a2',
    pending: { id: 'tu1', ask: false, question: 'Bash: pnpm test' },
    done: false,
  })
  const ended = readTurn([...records, t.result('r1', 'tu1', 'ok'), t.said('a4', 'All green.'), t.end('e2')])
  expect(ended).toMatchObject({ promptId: 'p2', text: 'All green.', pending: null, done: true })
  expect(readTurn([])).toMatchObject({ promptId: null, text: null, pending: null, done: false, start: 0 })
})

test('end of turn: Claude writes it, and Jarvis says it once, in one sentence of the last message', () => {
  const t = transcript()
  const working = [t.prompt('p1', 'the handoff'), t.said('a1', 'Reading the code.'), t.tool('a2', 'tu1', 'Read', { file_path: 'src/x.ts' })]
  const done = [...working, t.result('r1', 'tu1', 'text'), t.said('a3', '**Fixed** the test in `x.test.ts`. Then I opened PR #4.\n\nDetails…'), t.end('e1')]
  const { track, said } = run([
    { records: working, row: { status: 'busy' } },
    { records: done, row: { status: 'busy' } },
    // Read again, nothing new: said once.
    { records: done, row: { status: 'idle' } },
  ])
  expect(said).toEqual([{ kind: 'turn-ended', summary: 'Fixed the test in x.test.ts.' }])
  expect(track).toMatchObject({ state: 'idle', summary: 'Fixed the test in x.test.ts.', question: null })
})

test('end of turn with no end written (a Grok history): a claude agents row read well after the last line finds it idle', () => {
  const t = transcript()
  const records = [t.prompt('p1', 'the handoff'), t.said('a1', 'Done: the branch is pushed.')]
  const last = t.next() - 1000
  // Read in the same breath as the last line: maybe from before it, not believed.
  expect(run([{ records, row: { status: 'idle' }, rowAt: last + 1000 }]).said).toEqual([])
  expect(run([{ records, row: { status: 'idle' }, rowAt: last + ROW_LAG_MS + 1000 }]).said).toEqual([{ kind: 'turn-ended', summary: 'Done: the branch is pushed.' }])
  // An idle row while the parent has said nothing since the prompt is the TUI before it read it.
  expect(run([{ records: [t.prompt('p2', 'again')], row: { status: 'idle' }, rowAt: last + 60_000 }]).track.state).toBe('working')
})

test('a waiting approval: the row parked on a permission prompt, the question the tool call it waits on; said once per call', () => {
  const t = transcript()
  const records = [t.prompt('p1', 'the handoff'), t.tool('a1', 'tu1', 'Bash', { command: 'git push origin fix' })]
  const row: Row = { status: 'waiting', waiting_for: 'permission prompt' }
  const { track, said } = run([
    { records, row: { status: 'busy' } },
    { records, row },
    { records, row },
  ])
  expect(said).toEqual([{ kind: 'approval', question: 'Bash: git push origin fix' }])
  expect(track).toMatchObject({ state: 'approval', question: 'Bash: git push origin fix' })
  // The next call parked on another prompt is said too.
  const more = [...records, t.result('r1', 'tu1', 'pushed'), t.tool('a2', 'tu2', 'Bash', { command: 'gh pr create' })]
  expect(run([{ records: more, row }], track).said).toEqual([{ kind: 'approval', question: 'Bash: gh pr create' }])
})

test('a question: AskUserQuestion, which claude agents shows as input needed', () => {
  const t = transcript()
  const records = [t.prompt('p1', 'the handoff'), t.tool('a1', 'tu1', 'AskUserQuestion', { questions: [{ question: 'Which branch?', options: [] }] })]
  const { track, said } = run([{ records, row: { status: 'waiting', waiting_for: 'input needed' } }])
  expect(said).toEqual([{ kind: 'asking', question: 'Which branch?' }])
  expect(track).toMatchObject({ state: 'asking', question: 'Which branch?' })
})

test('a row read before the prompt was answered still shows the prompt: not believed; nor a dialog the person opened', () => {
  const t = transcript()
  const records = [t.prompt('p1', 'the handoff'), t.tool('a1', 'tu1', 'Bash', { command: 'rm -rf dist' })]
  const answered: Track = { ...HANDED, asked: 'tu1', answeredAt: T(100) }
  const stale = run([{ records, row: { status: 'waiting', waiting_for: 'permission prompt' }, rowAt: T(90) }], answered)
  expect(stale).toMatchObject({ said: [], track: { state: 'working' } })
  // Read after the answer and still waiting on it: back to approval, not said again.
  const still = run([{ records, row: { status: 'waiting', waiting_for: 'permission prompt' }, rowAt: T(110) }], answered)
  expect(still).toMatchObject({ said: [], track: { state: 'approval' } })
  expect(run([{ records, row: { status: 'waiting', waiting_for: 'dialog open' } }]).track.state).toBe('working')
})

test('before the handoff is typed the parent is starting, whatever it shows; its exit is said once', () => {
  const t = transcript()
  const records = [t.prompt('p1', 'x'), t.said('a1', 'Done.'), t.end('e1')]
  expect(run([{ records, row: { status: 'idle' } }], STARTING)).toEqual({ track: STARTING, said: [] })
  const { track, said } = run([
    { records, row: null, exited: true },
    { records, row: { status: 'busy' }, exited: true },
  ])
  expect(said).toEqual([{ kind: 'exited' }])
  expect(track.state).toBe('exited')
})

test('a child is never reported: only the parent’s own row and transcript are read, and a subagent’s lines are not its turn', () => {
  const t = transcript()
  const sub: TranscriptRecord = { ...t.said('s1', 'A child finished its part.'), isSidechain: true }
  const records = [t.prompt('p1', 'the handoff'), t.said('a1', 'Dispatched two children.'), sub]
  expect(readTurn(records).text).toBe('Dispatched two children.')
})

test('sentence: the first sentence, markdown dropped, capped', () => {
  expect(sentence('## Done\n\n- Fixed `a` and [b](http://x). More.')).toBe('Done Fixed a and b.')
  expect(sentence('no stop at all')).toBe('no stop at all')
  expect(sentence('x'.repeat(300))).toHaveLength(200)
})

/** The transcript clock's second `s`, ms. */
function T(s: number) {
  return Date.UTC(2026, 9, 23, 10, 0, s)
}

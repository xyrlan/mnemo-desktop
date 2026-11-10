import { sum } from '../world/format'
import { sampleWorld } from '../world/sample'
import { EMPTY, rosterOrder } from '../world/store'
import type { Pending, Session, World } from '../world/types'
import { HOUR, MIN, canFold, ctxAt, doingAt, earliest, fleet, fmt, laneOf, ownAt, planWindow, rows, scoreOf, spentShare, stateAt, step, ticks, treeAt, type Row } from './model'

const sample = sampleWorld()
const NOW = Date.parse('2026-11-09T21:30:00Z')
const T0 = NOW - 6 * HOUR

/** A session with nothing in it, for a world built in the test. */
const blank = (id: string, patch: Partial<Session> = {}): Session => ({
  ...sample.sessions[0],
  id,
  short: id.slice(0, 8),
  role: 'parent',
  parent: null,
  children: [],
  state: 'idle',
  live: true,
  title: id,
  startedAt: T0,
  lastAt: T0 + HOUR,
  activity: [],
  activityTotal: 0,
  timeline: [],
  context: { tokens: null, window: 200_000, percent: null, series: [], compactions: [] },
  prs: [],
  web: { searches: [], fetches: [], pages: [], shots: [], artifacts: [] },
  memory: { claude: { instructions: [], touches: [], skills: [] }, trail: { prompts: 0, injected: [], considered: [], read: [], briefings: [], frictions: [] } },
  ...patch,
})
const worldOf = (sessions: Session[], pending: Pending[] = []): World => ({ ...EMPTY, source: 'sample', at: NOW, sessions, pending })
const waits = (session: string, since: number): Pending => ({ id: `${session}:question`, session, kind: 'question', text: 'Which one?', detail: null, choices: [], reply: true, suggestedReply: null, pr: null, since })
const tokens = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 })
const names = (list: Row[]) => list.map((r) => (r.type === 'session' ? r.s.id : `[${r.sessions.map((s) => s.id).join(' ')}]`))

describe('the order of the lines', () => {
  test('is the roster’s order when nothing folds', () => {
    const list = rows(scoreOf(sample), new Set())
    expect(names(list)).toEqual(rosterOrder(sample).map((s) => s.id))
  })

  test('a child hangs one level under its parent', () => {
    for (const row of rows(scoreOf(sample), new Set())) {
      if (row.type === 'session') expect(row.depth).toBe(row.s.parent ? 1 : 0)
    }
  })

  const family = (extra: Pending[] = []) => {
    const kid = (id: string, state: Session['state'], lastAt: number) => blank(id, { role: 'child', parent: 'p', state, live: state !== 'ended', lastAt })
    return worldOf(
      [blank('p', { children: ['a', 'b', 'c', 'd'] }), kid('a', 'ended', T0 + 10 * MIN), kid('b', 'ended', T0 + 20 * MIN), kid('c', 'ended', T0 + 30 * MIN), kid('d', 'working', T0 + 40 * MIN), blank('q')],
      extra,
    )
  }

  test('three ended children fold into one lane, after the ones still going', () => {
    expect(names(rows(scoreOf(family()), new Set()))).toEqual(['p', 'd', '[c b a]', 'q'])
  })

  test('flipping a parent unfolds them, each on its own line', () => {
    expect(names(rows(scoreOf(family()), new Set(['p'])))).toEqual(['p', 'd', 'c', 'b', 'a', 'q'])
  })

  test('the selected session always has a line of its own', () => {
    expect(names(rows(scoreOf(family()), new Set(), 'b'))).toEqual(['p', 'd', 'b', '[c a]', 'q'])
  })

  test('an ended child something still waits on is never folded away', () => {
    const world = family([waits('a', T0 + 10 * MIN)])
    expect(names(rows(scoreOf(world), new Set(['p'])))).toContain('a')
    // two left to fold is under the default of three
    expect(names(rows(scoreOf(world), new Set()))).toEqual(['p', 'd', 'c', 'b', 'a', 'q'])
  })

  test('fewer than three ended children stay unfolded until asked', () => {
    const release = sample.sessions.find((s) => s.title.startsWith('Release 2.4'))!
    const sc = scoreOf(sample)
    expect(canFold(sc, release)).toBe(true)
    expect(rows(sc, new Set()).some((r) => r.type === 'ensemble')).toBe(false)
    const folded = rows(sc, new Set([release.id])).find((r) => r.type === 'ensemble')
    expect(folded?.type === 'ensemble' && folded.sessions.map((s) => s.title)).toEqual(['Shell completions for fish'])
  })
})

describe('a session at a past moment', () => {
  const series: [number, number][] = [
    [T0 + 10 * MIN, 1000],
    [T0 + 20 * MIN, 5000],
    [T0 + 30 * MIN, 2000],
  ]
  const one = blank('one', { context: { tokens: 2500, window: 200_000, percent: 1, series, compactions: [] }, totals: { own: tokens(80_000), tree: tokens(100_000) }, children: ['kid'], lastAt: T0 + 30 * MIN })
  const kid = blank('kid', { role: 'child', parent: 'one', startedAt: T0 + 20 * MIN, lastAt: T0 + 40 * MIN, totals: { own: tokens(20_000), tree: tokens(20_000) } })
  const sc = scoreOf(worldOf([one, kid]))

  test('its context is the last call’s size, held until the next', () => {
    expect(ctxAt(sc, one, T0 - MIN)).toBeNull()
    expect(ctxAt(sc, one, T0 + 15 * MIN)).toBe(1000)
    expect(ctxAt(sc, one, T0 + 25 * MIN)).toBe(5000)
    expect(ctxAt(sc, one, T0 + 3 * HOUR)).toBe(2000)
    expect(ctxAt(sc, one, NOW)).toBe(2500)
  })

  test('what it had spent is its total shared out along its context curve', () => {
    expect(spentShare(sc, one, T0)).toBe(0)
    expect(spentShare(sc, one, T0 + 15 * MIN)).toBe(1000 / 8000)
    expect(spentShare(sc, one, T0 + 25 * MIN)).toBe(6000 / 8000)
    expect(ownAt(sc, one, T0 + 25 * MIN)).toBe(60_000)
    expect(ownAt(sc, one, NOW)).toBe(80_000)
  })

  test('a session with no curve spends evenly over its life', () => {
    expect(spentShare(sc, kid, T0 + 30 * MIN)).toBe(0.5)
  })

  test('its tree is itself and everything under it by then, and the world’s total at now', () => {
    expect(treeAt(sc, one, T0 + 25 * MIN)).toBe(60_000 + 20_000 * 0.25)
    expect(treeAt(sc, one, NOW)).toBe(100_000)
  })

  test('its state: not started, working where the calls are, idle where they are not', () => {
    const call = { at: T0 + 30 * MIN, tool: 'Bash', kind: 'shell' as const, target: 'pnpm test', running: false, ok: true, ms: 4000 }
    const busy = blank('busy', { state: 'need', activity: [call], activityTotal: 1, timeline: [{ t: T0 + 30 * MIN, kinds: { shell: 1 } }], lastAt: T0 + 2 * HOUR })
    const at = scoreOf(worldOf([busy], [waits('busy', T0 + 3 * HOUR)]))
    expect(stateAt(at, busy, T0 - MIN)).toBeNull()
    expect(stateAt(at, busy, T0 + 31 * MIN)).toBe('working')
    expect(stateAt(at, busy, T0 + 90 * MIN)).toBe('idle')
    // after its last record and before it began to wait, it sat with its turn over
    expect(stateAt(at, busy, T0 + 150 * MIN)).toBe('idle')
    expect(stateAt(at, busy, T0 + 3 * HOUR + MIN)).toBe('need')
    expect(stateAt(at, busy, NOW)).toBe('need')
    expect(doingAt(at, busy, T0 + 31 * MIN)).toMatchObject({ act: { tool: 'Bash', target: 'pnpm test' } })
    expect(doingAt(at, busy, T0 + 90 * MIN)).toBeNull()
  })

  test('an ended session is ended once its last record has passed', () => {
    const done = blank('done', { state: 'ended', live: false })
    expect(stateAt(scoreOf(worldOf([done])), done, T0 + 2 * HOUR)).toBe('ended')
  })
})

describe('the lanes', () => {
  test('a call sits by what it does; a mnemo call goes to the memory lane', () => {
    expect([laneOf('edit'), laneOf('shell'), laneOf('read'), laneOf('web-fetch'), laneOf('memory'), laneOf('something new')]).toEqual([0, 1, 2, 3, -1, 2])
  })
})

describe('the fleet over the axis', () => {
  const sc = scoreOf(sample)
  const from = earliest(sc) - HOUR

  test('every token a session spent is in one interval, and in its account’s lane', () => {
    const made = fleet(sc, from, NOW + MIN, 5 * MIN, null)
    const spent = sample.sessions.reduce((n, s) => n + sum(s.totals.own), 0)
    const total = made.total.reduce((n, v) => n + v, 0)
    expect(total).toBeCloseTo(spent, -2)
    const lanes = Object.values(made.accounts).reduce((n, lane) => n + lane.reduce((m, v) => m + v, 0), 0)
    expect(lanes).toBeCloseTo(total, -2)
    expect(made.picked.every((v) => v === 0)).toBe(true)
  })

  test('the selected line’s share is its own spending', () => {
    const s = sample.sessions.find((x) => x.title.startsWith('Order status history'))!
    const made = fleet(sc, from, NOW + MIN, 5 * MIN, new Set([s.id]))
    expect(made.picked.reduce((n, v) => n + v, 0)).toBeCloseTo(sum(s.totals.own), -2)
  })

  test('nothing is counted outside the window asked for', () => {
    // three calls carrying 1000, 5000 and 2000 tokens of context; only the middle one is inside
    const series: [number, number][] = [
      [T0 + 10 * MIN, 1000],
      [T0 + 20 * MIN, 5000],
      [T0 + 30 * MIN, 2000],
    ]
    const one = blank('one', { context: { tokens: 2000, window: 200_000, percent: 1, series, compactions: [] }, totals: { own: tokens(80_000), tree: tokens(80_000) } })
    const made = fleet(scoreOf(worldOf([one])), T0 + 15 * MIN, T0 + 25 * MIN, 5 * MIN, null)
    expect([...made.total]).toEqual([0, 50_000])
  })

  test('the axis goes back two days, or to the oldest line when that is older', () => {
    expect(earliest(sc)).toBe(NOW - 48 * HOUR)
    const old = blank('old', { startedAt: NOW - 100 * HOUR, lastAt: NOW - 99 * HOUR })
    expect(earliest(scoreOf(worldOf([old])))).toBe(NOW - 100 * HOUR)
  })
})

describe('intervals and ticks', () => {
  test('a step is the smallest round interval wide enough to read', () => {
    expect(step(12 * HOUR, 1200, 7)).toBe(5 * MIN)
    expect(step(48 * HOUR, 1200, 7)).toBe(30 * MIN)
    expect(step(12 * HOUR, 1200, 24)).toBe(15 * MIN)
    expect(step(30 * MIN, 1200, 24)).toBe(MIN)
  })

  test('major ticks fall on round local clock times, inside the axis', () => {
    const list = ticks(NOW - 12 * HOUR, NOW, 1200)
    const major = list.filter((t) => t.major)
    expect(major.length).toBeGreaterThanOrEqual(5)
    for (const tick of list) {
      expect(tick.t).toBeGreaterThanOrEqual(NOW - 12 * HOUR)
      expect(tick.t).toBeLessThanOrEqual(NOW)
    }
    for (const tick of major) {
      const d = new Date(tick.t)
      expect([d.getHours() % 2, d.getMinutes()]).toEqual([0, 0])
    }
  })

  test('a plan window starts its length before its reset', () => {
    const limit = { kind: 'session', group: '', model: null, percent: 46, severity: 'normal', resetsAt: NOW + 2 * HOUR, active: true }
    expect(planWindow(limit)).toEqual({ from: NOW - 3 * HOUR, to: NOW + 2 * HOUR })
    expect(planWindow({ ...limit, kind: 'weekly_all' })?.from).toBe(NOW + 2 * HOUR - 7 * 24 * HOUR)
    expect(planWindow({ ...limit, resetsAt: null })).toBeNull()
  })
})

describe('words', () => {
  test('a length of time is said the way it is read', () => {
    expect([40e3, 14 * MIN, 140 * MIN, 21 * HOUR, 76 * HOUR].map(fmt.span)).toEqual(['40s', '14m', '2h 20m', '21h', '3d 4h'])
  })

  test('how long a call took', () => {
    expect([null, 118, 1800, 3 * MIN].map(fmt.took)).toEqual(['', '118ms', '1.8s', '3m'])
  })

  test('a path is cut to its last parts', () => {
    expect(fmt.tail('/home/you/work/atlas-api/src/lib/cache.ts')).toBe('…/lib/cache.ts')
    expect(fmt.tail('cache.ts')).toBe('cache.ts')
  })
})

import { describe, expect, it } from 'vitest'
import { child, parent } from '../mission/fixtures'
import type { ChildSession, ParentSession, Pr, RepoGroup, Snapshot } from '../mission/types'
import type { PulseEvent } from '../pulse/types'
import { logEvents } from './log'
import { buildShip, STRANDED_MS } from './ship'
import type { AgentView, CheckRun, Feed, PrFate, SessionFeed, Ship, ShipInput } from './ship-types'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const iso = (at: number) => new Date(at).toISOString()

const ROOT = '/Users/you/github/mnemo-desktop'
const P1 = '11111111-aaaa-4bbb-8ccc-000000000001'
const sid = (id: string) => `${id}-0000-4000-8000-000000000000`
const repo = (children: ChildSession[], over: Partial<RepoGroup> = {}): RepoGroup => ({ root: ROOT, name: 'mnemo-desktop', parents: [boss()], missions: [], children, ...over })
const snap = (...repos: RepoGroup[]): Snapshot => ({ repos, errors: [], at: iso(NOW) })
const boss = (over: Partial<ParentSession> = {}): ParentSession => parent({ session_id: P1, cwd: ROOT, status: 'idle', ...over })
const kid = (id: string, over: Partial<ChildSession> = {}): ChildSession =>
  child({ id, session_id: sid(id), cwd: `${ROOT}-wt-${id}`, updated_at: iso(NOW - 10 * SEC), parent_session: P1, ...over })
const pr = (n: number, over: Partial<Pr> = {}): Pr => ({ number: n, url: `https://github.com/you/mnemo-desktop/pull/${n}`, state: 'OPEN', head: `fix/issue-${n}`, ci: 'pending', ...over })
const sf = (over: Partial<SessionFeed> = {}): SessionFeed => ({ activity: null, said: null, context: null, model: null, topic: null, title: null, contract: null, ask: null, ...over })
const fate = (over: Partial<PrFate> = {}): PrFate => ({ state: 'OPEN', mergedAt: null, closedAt: null, checks: [], ...over })
const check = (startedAt: number, completedAt: number | null, conclusion = 'SUCCESS'): CheckRun => ({ name: 'test', startedAt, completedAt, conclusion })
const feedOf = (sessions: Record<string, SessionFeed> = {}, prs: Record<string, PrFate> = {}): Feed => ({ sessions, prs, rate: null, at: NOW })
const working: AgentView = { state: 'working', waitingFor: null, title: '' }

function ship(children: ChildSession[], over: Partial<ShipInput> = {}, now = NOW): Ship {
  const agents = Object.fromEntries(children.map((c) => [c.session_id ?? c.id, working]))
  return buildShip({ snapshot: snap(repo(children)), feed: null, agents, events: [], firstSeen: { [P1]: NOW - HOUR }, now, ...over })
}
const kinds = (evs: ReturnType<typeof logEvents>) => evs.map((e) => [e.kind, e.robotId])

describe('logEvents: the first build', () => {
  it('does not log the robots already aboard as dispatched, nor their PRs as opened', () => {
    const s = ship([kid('a1'), kid('b1', { pr: pr(7) })])
    expect(logEvents(null, s, NOW)).toEqual([])
  })

  it('logs what the data dates: a CI verdict, a finish, a strand, a fate', () => {
    const green = kid('g1', { live: false, state: 'stopped', updated_at: iso(NOW - HOUR), pr: pr(7) })
    const done = kid('d1', { live: false, state: 'stopped', updated_at: iso(NOW - 10 * MIN) })
    const idle = kid('s1', { updated_at: iso(NOW - 20 * MIN) })
    const gone = kid('m1', { live: false, state: 'stopped', updated_at: iso(NOW - 2 * HOUR), pr: pr(8) })
    const undated = kid('u1', { live: false, state: 'stopped', updated_at: iso(NOW - 2 * HOUR), pr: pr(9, { state: 'MERGED' }) })
    const feed = feedOf({}, {
      [pr(7).url]: fate({ checks: [check(NOW - 50 * MIN, NOW - 40 * MIN), check(NOW - 50 * MIN, NOW - 45 * MIN)] }),
      [pr(8).url]: fate({ state: 'MERGED', mergedAt: NOW - 30 * MIN }),
    })
    const evs = logEvents(null, ship([green, done, idle, gone, undated], { feed }), NOW)
    expect(evs.map((e) => [e.kind, e.robotId, e.at])).toEqual([
      ['ci-green', 'g1', NOW - 40 * MIN],
      ['merged', 'm1', NOW - 30 * MIN],
      ['finished', 'd1', NOW - 10 * MIN],
      ['stranded', 's1', NOW - 20 * MIN + STRANDED_MS],
    ])
    expect(evs.map((e) => e.text)).toEqual(['g1 CI green on PR #7', 'm1 PR #8 merged — lifted off', 'd1 finished without a PR', 's1 stranded — idle for 20 min'])
  })
})

describe('logEvents: changes', () => {
  it('logs nothing when nothing changed', () => {
    const s = ship([kid('a1'), kid('b1', { pr: pr(7) })])
    expect(logEvents(s, ship([kid('a1'), kid('b1', { pr: pr(7) })]), NOW)).toEqual([])
  })

  it('logs a new robot as dispatched by its captain', () => {
    const before = ship([])
    const after = ship([kid('a1', { cwd: `${ROOT}-wt-682` })], { agents: { [P1]: { state: 'working', waitingFor: null, title: 'nexus round' }, [sid('a1')]: working } })
    expect(logEvents(before, after, NOW)).toEqual([
      { id: 'dispatched:a1', at: NOW, kind: 'dispatched', robotId: 'a1', captainId: P1, text: '#682 dispatched by ◆ nexus round' },
    ])
  })

  it('logs a child with no recorded parent as dispatched, without a captain to name', () => {
    const after = ship([kid('o1', { parent_session: null })])
    expect(logEvents(ship([]), after, NOW).map((e) => e.text)).toEqual(['o1 dispatched'])
  })

  it('logs an opened PR, then its CI verdict at the checks’ own time', () => {
    const a = ship([kid('a1')])
    const b = ship([kid('a1', { pr: pr(7) })])
    expect(kinds(logEvents(a, b, NOW))).toEqual([['pr-opened', 'a1']])
    const c = ship([kid('a1', { pr: pr(7) })], { feed: feedOf({}, { [pr(7).url]: fate({ checks: [check(NOW - 9 * MIN, NOW - 2 * MIN, 'FAILURE')] }) }) })
    const red = logEvents(b, c, NOW)
    expect(red.map((e) => [e.kind, e.at, e.text])).toEqual([['ci-red', NOW - 2 * MIN, 'a1 CI red on PR #7']])
    // A re-run going green is its own milestone.
    const d = ship([kid('a1', { pr: pr(7) })], { feed: feedOf({}, { [pr(7).url]: fate({ checks: [check(NOW - MIN, NOW - 10 * SEC)] }) }) })
    const green = logEvents(c, d, NOW)
    expect(kinds(green)).toEqual([['ci-green', 'a1']])
    expect(green[0].id).not.toBe(red[0].id.replace('ci-red', 'ci-green'))
  })

  it('logs a merge or a close when the robot leaves, at the fate’s own time', () => {
    const c = kid('a1', { live: false, state: 'stopped', updated_at: iso(NOW - HOUR), pr: pr(7) })
    const before = ship([c])
    const merged = ship([c], { feed: feedOf({}, { [pr(7).url]: fate({ state: 'MERGED', mergedAt: NOW - 20 * SEC }) }) })
    expect(logEvents(before, merged, NOW).map((e) => [e.id, e.kind, e.at, e.text])).toEqual([['merged:a1:7', 'merged', NOW - 20 * SEC, 'a1 PR #7 merged — lifted off']])
    const closed = ship([c], { feed: feedOf({}, { [pr(7).url]: fate({ state: 'CLOSED', closedAt: NOW - 20 * SEC }) }) })
    expect(kinds(logEvents(before, closed, NOW))).toEqual([['closed', 'a1']])
    // Once gone, it is not logged again.
    expect(logEvents(merged, merged, NOW)).toEqual([])
  })

  it('logs a finish without a PR when the robot turns done', () => {
    const c = kid('a1', { live: false, state: 'stopped', updated_at: iso(NOW - 2 * MIN) })
    const before = ship([c], {}, NOW - 90 * SEC)
    const after = ship([c])
    expect(logEvents(before, after, NOW).map((e) => [e.kind, e.at])).toEqual([['finished', NOW - 2 * MIN]])
  })

  it('logs a strand when it happens, again after the robot worked in between', () => {
    const c = kid('a1', { updated_at: iso(NOW - 14 * MIN) })
    const before = ship([c])
    const after = ship([c], {}, NOW + 2 * MIN)
    const first = logEvents(before, after, NOW + 2 * MIN)
    expect(first.map((e) => [e.kind, e.at])).toEqual([['stranded', NOW - 14 * MIN + STRANDED_MS]])
    const woke = ship([kid('a1', { updated_at: iso(NOW + 3 * MIN) })], {}, NOW + 3 * MIN)
    const again = ship([kid('a1', { updated_at: iso(NOW + 3 * MIN) })], {}, NOW + 20 * MIN)
    const second = logEvents(woke, again, NOW + 20 * MIN)
    expect(kinds(second)).toEqual([['stranded', 'a1']])
    expect(second[0].id).not.toBe(first[0].id)
  })

  it('logs a robot blocked, with what it asks', () => {
    const a = ship([kid('a1')])
    const b = ship([kid('a1')], { feed: feedOf({ a1: sf({ ask: { question: 'Which layout should the deck use?', options: ['a', 'b'] } }) }) })
    expect(logEvents(a, b, NOW).map((e) => [e.kind, e.text])).toEqual([['blocked', 'a1 asks: Which layout should the deck use?']])
    const perm = ship([kid('a1', { tempo: 'blocked', needs: 'approve Bash: rm -rf target', waiting_for: 'permission prompt' })], { agents: {} })
    expect(logEvents(a, perm, NOW).map((e) => e.text)).toEqual(['a1 wants to run Bash: rm -rf target'])
  })

  it('logs each newly injected rule once', () => {
    const ev = (at: number, slugs: string[]): PulseEvent => ({ at, kind: 'reflex', project: 'mnemo-desktop', agent: 'x', slugs, session_id: sid('a1') })
    const a = ship([kid('a1', { cwd: `${ROOT}-wt-682` })], { events: [ev(NOW - MIN, ['old'])] })
    const b = ship([kid('a1', { cwd: `${ROOT}-wt-682` })], { events: [ev(NOW - MIN, ['old']), ev(NOW - 30 * SEC, ['merge-requires-admin']), ev(NOW, ['other', 'old'])] })
    expect(logEvents(a, b, NOW).map((e) => [e.id, e.text])).toEqual([
      ['rule:a1:merge-requires-admin', '#682 got `merge-requires-admin`'],
      ['rule:a1:other', '#682 got `other`'],
    ])
    expect(logEvents(null, b, NOW)).toEqual([])
  })

  it('gives the same milestone the same id on every build, so the store logs it once', () => {
    const c = kid('a1', { pr: pr(7) })
    const before = ship([])
    const x = logEvents(before, ship([c]), NOW)
    const y = logEvents(before, ship([c], {}, NOW + 3 * SEC), NOW + 3 * SEC)
    expect(x.map((e) => e.id)).toEqual(y.map((e) => e.id))
    expect(x.map((e) => e.id)).toEqual(['dispatched:a1', 'pr-opened:a1:7'])
  })
})

describe('logEvents: a captain waiting on you', () => {
  const lead = (view: AgentView | null, feed: Feed | null = null, now = NOW) =>
    buildShip({ snapshot: snap(repo([])), feed, agents: view ? { [P1]: view } : {}, events: [], firstSeen: { [P1]: NOW - HOUR }, now })
  const waits = (waitingFor: AgentView['waitingFor']): AgentView => ({ state: 'needs-you', waitingFor, title: 'fleet lead' })
  const pushing = (at: number) => feedOf({ [P1]: sf({ activity: { tool: 'Bash', target: 'git push', at, running: true } }) })

  it('logs a blocked milestone for that captain when it starts waiting, once', () => {
    const idle = lead({ state: 'idle', waitingFor: null, title: 'fleet lead' })
    const blocked = lead(waits('permission'))
    const evs = logEvents(idle, blocked, NOW)
    expect(evs.map((e) => [e.kind, e.robotId, e.captainId, e.text])).toEqual([['blocked', null, P1, 'fleet lead waits on a permission']])
    expect(logEvents(blocked, lead(waits('permission'), null, NOW + MIN), NOW + MIN)).toEqual([])
  })

  it('logs on the first build too, as a blocked robot is', () => {
    expect(kinds(logEvents(null, lead(waits('permission')), NOW))).toEqual([['blocked', null]])
  })

  it('says the question when the feed has one', () => {
    const feed = feedOf({ [P1]: sf({ ask: { question: 'Which schema?', options: ['v1', 'v2'] } }) })
    expect(logEvents(null, lead(waits('question'), feed), NOW).map((e) => e.text)).toEqual(['fleet lead asks: Which schema?'])
    expect(logEvents(null, lead(waits('question')), NOW).map((e) => e.text)).toEqual(['fleet lead waits on a question'])
  })

  it('a later wait on the same kind of prompt is a new milestone', () => {
    const first = logEvents(null, lead(waits('permission'), pushing(NOW - MIN)), NOW)
    const later = logEvents(lead(working, pushing(NOW + 5 * MIN)), lead(waits('permission'), pushing(NOW + 9 * MIN), NOW + 10 * MIN), NOW + 10 * MIN)
    expect(first).toHaveLength(1)
    expect(later).toHaveLength(1)
    expect(later[0].id).not.toBe(first[0].id)
  })
})

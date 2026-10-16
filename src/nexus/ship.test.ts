import { describe, expect, it } from 'vitest'
import { child, parent } from '../mission/fixtures'
import type { ChildSession, Mission, ParentSession, Pr, RepoGroup, Snapshot } from '../mission/types'
import type { PulseEvent } from '../pulse/types'
import { explainError } from '../mission/errors'
import { actionOf, ago, buildShip, ciAt, departuresOf, firstSentence, LINGER_MS, RUNNING_MAX_MS, snapshotExceptions, STRANDED_MS, WORK_GAP_MS } from './ship'
import { orphanCaptainId, type AgentView, type CheckRun, type Feed, type PrFate, type SessionFeed, type Ship, type ShipInput, type ShipRobot } from './ship-types'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const ROOT = '/Users/you/github/mnemo-desktop'
const MNEMO = '/Users/you/github/mnemo'
const P1 = '11111111-aaaa-4bbb-8ccc-000000000001'
const P2 = '22222222-aaaa-4bbb-8ccc-000000000002'
const P3 = '33333333-aaaa-4bbb-8ccc-000000000003'
const GONE = '99999999-dddd-4eee-8fff-000000000009'

const repo = (over: Partial<RepoGroup> = {}): RepoGroup => ({ root: ROOT, name: 'mnemo-desktop', parents: [], missions: [], children: [], ...over })
const snap = (...repos: RepoGroup[]): Snapshot => ({ repos, errors: [], at: new Date(NOW).toISOString() })
const boss = (over: Partial<ParentSession> = {}): ParentSession => parent({ session_id: P1, cwd: ROOT, status: 'idle', ...over })
const sid = (id: string) => `${id}-0000-4000-8000-000000000000`
/** A live child that wrote a moment ago, in its own worktree, under P1. */
const kid = (id: string, over: Partial<ChildSession> = {}): ChildSession =>
  child({ id, session_id: sid(id), cwd: `${ROOT}-wt-${id}`, updated_at: iso(10 * SEC), parent_session: P1, ...over })
const pr = (n: number, over: Partial<Pr> = {}): Pr => ({ number: n, url: `https://github.com/you/mnemo-desktop/pull/${n}`, state: 'OPEN', head: `fix/issue-${n}`, ci: 'pending', ...over })
const sf = (over: Partial<SessionFeed> = {}): SessionFeed => ({ activity: null, said: null, context: null, model: null, topic: null, title: null, contract: null, ask: null, ...over })
const check = (startedAgo: number | null, completedAgo: number | null, conclusion: string | null = 'SUCCESS'): CheckRun => ({
  name: 'test',
  startedAt: startedAgo === null ? null : NOW - startedAgo,
  completedAt: completedAgo === null ? null : NOW - completedAgo,
  conclusion,
})
const fate = (over: Partial<PrFate> = {}): PrFate => ({ state: 'OPEN', mergedAt: null, closedAt: null, checks: [], ...over })
const feedOf = (sessions: Record<string, SessionFeed> = {}, prs: Record<string, PrFate> = {}): Feed => ({ sessions, prs, rate: null, at: NOW })
const working = (title = ''): AgentView => ({ state: 'working', waitingFor: null, title })

function ship(snapshot: Snapshot, over: Partial<ShipInput> = {}): Ship {
  return buildShip({ snapshot, feed: null, agents: {}, events: [], firstSeen: {}, now: NOW, ...over })
}
const robots = (s: Ship): ShipRobot[] => [...s.bridge.blocked, ...s.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]
const robot = (s: Ship, id: string): ShipRobot => {
  const r = robots(s).find((x) => x.id === id)
  if (!r) throw new Error(`no robot ${id}`)
  return r
}
const has = (s: Ship, id: string) => robots(s).some((r) => r.id === id)
/** One child under a live P1, with the fleet listing it as working unless `agents` says otherwise. */
const one = (c: ChildSession, over: Partial<ShipInput> = {}) =>
  ship(snap(repo({ parents: [boss()], children: [c] })), { agents: { [c.session_id ?? c.id]: working() }, ...over })

describe('helpers', () => {
  it('prints durations as the prototype does', () => {
    expect([ago(5 * SEC), ago(6 * MIN), ago(90 * MIN)]).toEqual(['5s', '6 min', '1.5 h'])
    expect(ago(2 * HOUR)).toBe('2 h')
  })

  it('takes the first sentence of a long text, without markdown marks', () => {
    expect(firstSentence('**Done.** The `ship` suite passes. Next, the PR.')).toBe('Done. The ship suite passes.')
    expect(firstSentence('Short. Too short.')).toBe('Short. Too short.')
    expect(firstSentence('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
  })

  it('reads the action from the tool and what it runs', () => {
    expect(actionOf({ tool: 'Edit', target: 'src/a.ts' })).toBe('edit')
    expect(actionOf({ tool: 'Bash', target: 'pnpm test src/nexus' })).toBe('test')
    expect(actionOf({ tool: 'Bash', target: 'gh pr create --fill' })).toBe('ship')
    expect(actionOf({ tool: 'Bash', target: "sed -i '' s/a/b/ x.ts" })).toBe('edit')
    expect(actionOf({ tool: 'Bash', target: 'ls src' })).toBe('read')
    expect(actionOf({ tool: 'Grep', target: 'buildShip' })).toBe('read')
  })

  it('gives CI at a moment from when each check started and finished', () => {
    expect(ciAt([], NOW)).toBeNull()
    expect(ciAt([check(null, null)], NOW)).toBe('wait')
    expect(ciAt([check(-MIN, null)], NOW)).toBe('wait')
    expect(ciAt([check(5 * MIN, null), check(5 * MIN, MIN)], NOW)).toBe('run')
    expect(ciAt([check(5 * MIN, -MIN)], NOW)).toBe('run')
    expect(ciAt([check(5 * MIN, MIN), check(5 * MIN, 2 * MIN, 'SKIPPED')], NOW)).toBe('green')
    expect(ciAt([check(5 * MIN, MIN), check(5 * MIN, 2 * MIN, 'FAILURE')], NOW)).toBe('red')
    expect(ciAt([check(5 * MIN, MIN, 'TIMED_OUT')], NOW)).toBe('red')
  })
})

describe('buildShip: is it busy', () => {
  it('takes the fleet as the answer: a child it lists working, with a recent action, works', () => {
    const r = robot(one(kid('a1')), 'a1')
    expect([r.state, r.zone]).toEqual(['working', 'flight'])
  })

  it('draws a child working when the fleet says so though the snapshot tempo says idle (the v1 bug)', () => {
    expect(robot(one(kid('a1', { tempo: 'idle' })), 'a1').state).toBe('working')
  })

  it('has a child the fleet lists as done or idle not working, whatever its tempo', () => {
    const r = robot(one(kid('a1'), { agents: { [sid('a1')]: { state: 'idle', waitingFor: null, title: '' } } }), 'a1')
    expect(r.state).toBe('idle')
  })

  it('fills in from the snapshot for a child the fleet does not list', () => {
    const s = ship(snap(repo({ parents: [boss()], children: [kid('a1'), kid('b2', { tempo: 'blocked', needs: 'may I add a crate?' })] })))
    expect(robot(s, 'a1').state).toBe('working')
    expect(robot(s, 'b2').state).toBe('need')
  })

  it('goes idle after 150 s without an action, from the newest of the job, the last tool and the last sentence', () => {
    const c = kid('a1', { updated_at: iso(10 * MIN) })
    expect(robot(one(c), 'a1').state).toBe('idle')
    expect(robot(one(c), 'a1').idleMs).toBe(10 * MIN)
    const fresh = feedOf({ a1: sf({ activity: { tool: 'Read', target: 'x.ts', at: NOW - WORK_GAP_MS + SEC, running: false } }) })
    expect(robot(one(c, { feed: fresh }), 'a1').state).toBe('working')
    const said = feedOf({ a1: sf({ said: { text: 'Reading the spec now.', at: NOW - 30 * SEC } }) })
    expect(robot(one(c, { feed: said }), 'a1').idleMs).toBe(30 * SEC)
  })

  it('counts a tool call awaiting its result for under 3 h as working: a long command running', () => {
    const c = kid('a1', { updated_at: iso(20 * MIN) })
    const feed = feedOf({ a1: sf({ activity: { tool: 'Bash', target: 'gh pr checks 7 --watch', at: NOW - 9 * MIN, running: true } }) })
    const r = robot(one(c, { feed }), 'a1')
    expect([r.state, r.zone, r.action]).toEqual(['working', 'flight', 'run'])
    expect(r.act).toBe('⧗ running for 9 min · ⌘ Bash · gh pr checks 7 --watch')

    const stale = feedOf({ a1: sf({ activity: { tool: 'Bash', target: 'pnpm test', at: NOW - RUNNING_MAX_MS - SEC, running: true } }) })
    expect(robot(one(c, { feed: stale }), 'a1').zone).toBe('stranded')
  })

  it('badges a working robot with its current tool, from the feed, else from a `Running` detail', () => {
    const feed = feedOf({ a1: sf({ activity: { tool: 'Edit', target: 'src/nexus/ship.ts', at: NOW - 5 * SEC, running: false } }) })
    const r = robot(one(kid('a1'), { feed }), 'a1')
    expect([r.action, r.act]).toEqual(['edit', '✎ Edit · src/nexus/ship.ts'])
    expect(robot(one(kid('a1', { detail: 'Running pnpm test' })), 'a1').action).toBe('test')
    expect(robot(one(kid('a1')), 'a1').action).toBe('read')
    expect(robot(one(kid('a1', { updated_at: iso(5 * MIN) })), 'a1').action).toBeNull()
  })
})

describe('buildShip: need', () => {
  it('asks a question from the feed, with its options, and climbs to the bridge', () => {
    const feed = feedOf({ a1: sf({ ask: { question: 'Which layout?', options: ['attention', 'station'] } }) })
    const s = one(kid('a1'), { feed })
    const r = robot(s, 'a1')
    expect([r.state, r.zone, r.need]).toEqual(['need', 'bridge', { kind: 'question', text: 'Which layout?', options: ['attention', 'station'] }])
    expect(s.bridge.blocked.map((x) => x.id)).toEqual(['a1'])
    expect(s.decks[0].flight).toEqual([])
    expect(s.counts.need).toBe(1)
  })

  it('asks the snapshot’s question when the feed has none', () => {
    const r = robot(one(kid('a1', { tempo: 'blocked', needs: 'may I add a crate?' }), { agents: {} }), 'a1')
    expect(r.need).toEqual({ kind: 'question', text: 'may I add a crate?', options: [] })
  })

  it('asks a permission with yes / always / no, naming the tool call', () => {
    const c = kid('a1', { tempo: 'blocked', needs: 'approve Bash: rm -rf target', waiting_for: 'permission prompt' })
    const r = robot(one(c, { agents: { [sid('a1')]: { state: 'needs-you', waitingFor: 'permission', title: '' } } }), 'a1')
    expect(r.need).toEqual({ kind: 'permission', text: 'Bash: rm -rf target', options: ['yes', 'always', 'no'] })
  })

  it('does not ask you for a child stopped by the account’s rate limit', () => {
    const c = kid('a1', { tempo: 'blocked', needs: 'rate limited — wait and retry' })
    expect(robot(one(c, { agents: {} }), 'a1').state).not.toBe('need')
  })

  it('does not ask for an ended child, whatever its transcript left unanswered', () => {
    const feed = feedOf({ a1: sf({ ask: { question: 'Which?', options: [] } }) })
    const r = robot(one(kid('a1', { live: false, state: 'stopped', updated_at: iso(5 * MIN) }), { feed }), 'a1')
    expect(r.state).toBe('done')
  })
})

describe('buildShip: done, leaving and the PR', () => {
  it('is done 60 s after it ended, and in the hangar', () => {
    const soon = robot(one(kid('a1', { live: false, state: 'stopped', updated_at: iso(30 * SEC) })), 'a1')
    expect(soon.state).not.toBe('done')
    const r = robot(one(kid('a1', { live: false, state: 'stopped', updated_at: iso(2 * MIN) })), 'a1')
    expect([r.state, r.zone, r.action, r.act]).toEqual(['done', 'hangar', null, null])
  })

  it('leaves 40 min after it ended when it has no PR', () => {
    expect(has(one(kid('a1', { live: false, state: 'done', updated_at: iso(LINGER_MS - MIN) })), 'a1')).toBe(true)
    expect(has(one(kid('a1', { live: false, state: 'done', updated_at: iso(LINGER_MS + MIN) })), 'a1')).toBe(false)
    expect(has(one(kid('a1', { live: false, state: 'done', updated_at: null })), 'a1')).toBe(false)
  })

  it('stays in the hangar while its PR is open, however long ago it ended', () => {
    const c = kid('a1', { live: false, state: 'stopped', updated_at: iso(5 * HOUR), pr: pr(7, { ci: 'pass' }) })
    const r = robot(one(c), 'a1')
    expect([r.state, r.zone, r.ci, r.idleMs]).toEqual(['done', 'hangar', 'green', 5 * HOUR])
  })

  it('waits in the hangar, never stranded, when live and idle with an open PR', () => {
    const r = robot(one(kid('a1', { updated_at: iso(30 * MIN), pr: pr(7) }), { agents: {} }), 'a1')
    expect([r.state, r.zone]).toEqual(['idle', 'hangar'])
  })

  it('takes CI from its fate’s checks at now, else from the snapshot', () => {
    const c = kid('a1', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(7, { ci: 'pass' }) })
    const feed = feedOf({}, { [pr(7).url]: fate({ checks: [check(10 * MIN, null)] }) })
    const r = robot(one(c, { feed }), 'a1')
    expect([r.ci, r.fate?.checks.length]).toEqual(['run', 1])
    expect(robot(one(c), 'a1').ci).toBe('green')
    expect(robot(one(kid('a1')), 'a1').ci).toBeNull()
  })

  it('leaves the ship when its PR merged or closed before now, and says so to the log', () => {
    const c = kid('a1', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(7) })
    const merged = one(c, { feed: feedOf({}, { [pr(7).url]: fate({ state: 'MERGED', mergedAt: NOW - MIN }) }) })
    expect(has(merged, 'a1')).toBe(false)
    expect(departuresOf(merged).map((d) => [d.robot.id, d.kind, d.at])).toEqual([['a1', 'merged', NOW - MIN]])

    const closed = one(c, { feed: feedOf({}, { [pr(7).url]: fate({ state: 'CLOSED', closedAt: NOW - MIN }) }) })
    expect(departuresOf(closed).map((d) => [d.kind, d.at])).toEqual([['closed', NOW - MIN]])

    const later = one(c, { feed: feedOf({}, { [pr(7).url]: fate({ state: 'MERGED', mergedAt: NOW + MIN }) }) })
    expect(has(later, 'a1')).toBe(true)

    const bySnapshot = one({ ...c, pr: pr(7, { state: 'MERGED' }) })
    expect(has(bySnapshot, 'a1')).toBe(false)
    expect(departuresOf(bySnapshot).map((d) => [d.kind, d.at])).toEqual([['merged', null]])
  })

  it('reads a contract piece’s PR from its piece, and labels it by the piece', () => {
    const c = kid('c1', { cwd: `${ROOT}-wt-c-ship`, branch: 'feat/nexus-v2/ship', live: false, state: 'stopped', updated_at: iso(HOUR) })
    const mission: Mission = { feature: 'nexus-v2', contract_path: `${ROOT}/docs/c.md`, landable: false, pieces: [{ name: 'ship', branch: 'feat/nexus-v2/ship', child: c, pr: pr(426, { ci: 'pass' }) }] }
    const r = robot(ship(snap(repo({ parents: [boss()], missions: [mission], children: [c] }))), 'c1')
    expect([r.label, r.pr?.number, r.zone]).toEqual(['ship', 426, 'hangar'])
    expect(robots(ship(snap(repo({ parents: [boss()], missions: [mission], children: [c] }))))).toHaveLength(1)
  })
})

describe('buildShip: what a robot shows', () => {
  it('says its own detail, else its last assistant sentence; `stopped` is no line', () => {
    const feed = feedOf({ a1: sf({ said: { text: 'All 41 ship tests pass now. Opening the PR next.', at: NOW - MIN } }) })
    expect(robot(one(kid('a1', { detail: 'writing the ship' }), { feed }), 'a1').line).toBe('writing the ship')
    expect(robot(one(kid('a1', { detail: '' }), { feed }), 'a1').line).toBe('All 41 ship tests pass now.')
    expect(robot(one(kid('a1', { detail: 'stopped', live: false, state: 'stopped' }), { feed }), 'a1').line).toBe('All 41 ship tests pass now.')
  })

  it('reads an idle robot’s act line with its last tool', () => {
    const feed = feedOf({ a1: sf({ activity: { tool: 'Bash', target: 'ls', at: NOW - 6 * MIN, running: false } }) })
    expect(robot(one(kid('a1', { updated_at: iso(6 * MIN) }), { feed }), 'a1').act).toBe('… idle for 6 min · last: Bash')
  })

  it('takes the model from the snapshot, else from the transcript, so a lean child is not grey', () => {
    const feed = feedOf({ a1: sf({ model: 'claude-sonnet-4-5', context: 120_000 }) })
    const r = robot(one(kid('a1', { model: null }), { feed }), 'a1')
    expect([r.model, r.klass, r.context]).toEqual(['claude-sonnet-4-5', 'droid', 120_000])
    const own = robot(one(kid('a1', { model: 'opus[1m]' }), { feed }), 'a1')
    expect([own.model, own.klass]).toEqual(['opus[1m]', 'mech'])
    expect(robot(one(kid('a1')), 'a1').klass).toBe('unknown')
  })

  it('carries the contract, and the rules mnemo injected into its session, newest first', () => {
    const contract = { feature: 'nexus-v2', piece: 'ship', consumes: ['feed'] }
    const ev = (at: number, kind: PulseEvent['kind'], slugs: string[], session_id = sid('a1')): PulseEvent => ({ at, kind, project: 'mnemo-desktop', agent: 'x', slugs, session_id })
    const events = [ev(NOW - 3 * MIN, 'catchup', ['old-rule']), ev(NOW - MIN, 'reflex', ['merge-requires-admin']), ev(NOW - MIN, 'tool', ['searched']), ev(NOW, 'reflex', ['other'], P1)]
    const r = robot(one(kid('a1'), { feed: feedOf({ a1: sf({ contract }) }), events }), 'a1')
    expect(r.contract).toEqual(contract)
    expect(r.injected).toEqual(['merge-requires-admin', 'old-rule'])
  })

  it('labels a child by its issue worktree and seeds its accessory from its id', () => {
    const r = robot(one(kid('a1', { cwd: `${ROOT}-wt-682` })), 'a1')
    expect(r.label).toBe('#682')
    expect(r.accessory).toBe(robot(one(kid('a1', { cwd: `${ROOT}-wt-682` })), 'a1').accessory)
  })

  it('suffixes twins under one captain sharing an issue a, b … in spawn order, and keeps them when one leaves', () => {
    const a = kid('t2', { cwd: `${ROOT}-wt-404-x` })
    const b = kid('t1', { cwd: `${ROOT}-wt-404-y` })
    const firstSeen = { [sid('t2')]: NOW - 2 * MIN, [sid('t1')]: NOW - MIN }
    const s = ship(snap(repo({ parents: [boss()], children: [b, a] })), { firstSeen })
    expect([robot(s, 't2').label, robot(s, 't2').twin, robot(s, 't1').label]).toEqual(['#404·a', 'a', '#404·b'])

    const merged = { ...a, pr: pr(9, { state: 'MERGED' }) }
    const after = ship(snap(repo({ parents: [boss()], children: [b, merged] })), { firstSeen })
    expect(robot(after, 't1').label).toBe('#404·b')

    const alone = ship(snap(repo({ parents: [boss()], children: [kid('t1', { cwd: `${ROOT}-wt-404-y` })] })))
    expect([robot(alone, 't1').label, robot(alone, 't1').twin]).toEqual(['#404', null])
  })
})

describe('buildShip: captains', () => {
  it('stands a grandchild under its top captain, tagged with the child that dispatched it', () => {
    const mid = kid('m1', { cwd: `${ROOT}-wt-661` })
    const grand = kid('g1', { parent_session: sid('m1') })
    const s = ship(snap(repo({ parents: [boss()], children: [mid, grand] })))
    expect([robot(s, 'g1').captainId, robot(s, 'g1').via]).toEqual([P1, '#661'])
    expect(robot(s, 'm1').via).toBeNull()
  })

  it('stands a child with no recorded parent by the empty chair of its repo', () => {
    const s = ship(snap(repo({ children: [kid('o1', { parent_session: null })] })))
    expect(robot(s, 'o1').captainId).toBe(orphanCaptainId(ROOT))
    expect(s.decks[0].captains.map((c) => [c.id, c.pose, c.emblem, c.parent])).toEqual([[orphanCaptainId(ROOT), 'empty', '?', null]])
  })

  it('slumps a recorded parent that is no longer live, under which its children still stand', () => {
    const s = ship(snap(repo({ children: [kid('a1', { parent_session: GONE })] })))
    const cap = s.decks[0].captains[0]
    expect([cap.id, cap.pose, cap.parent, cap.name]).toEqual([GONE, 'offline', null, 'session 99999999'])
  })

  it("names a captain by the feed's title, else Home's title, else its claude agents name", () => {
    const one = snap(repo({ parents: [boss({ name: 'mnemo-18' })], children: [kid('a1')] }))
    const agents = { [P1]: { state: 'idle' as const, waitingFor: null, title: '[11/10/2026, 14:02:11] lorem' } }
    const named = ship(one, { agents, feed: feedOf({ [P1]: sf({ topic: '[Pasted text #1 +12 lines]', title: 'Second version of the checkout' }) }) })
    expect(named.decks[0].captains[0].name).toBe('Second version of the checkout')
    expect(ship(one, { agents, feed: feedOf({ [P1]: sf({ topic: 'lorem' }) }) }).decks[0].captains[0].name).toBe('[11/10/2026, 14:02:11] lorem')
    expect(ship(one).decks[0].captains[0].name).toBe('mnemo-18')
  })

  it('poses a captain: alert when a child needs you, busy as the fleet says, else idle', () => {
    const blocked = kid('b1', { tempo: 'blocked', needs: 'which?' })
    expect(ship(snap(repo({ parents: [boss()], children: [blocked] }))).decks[0].captains[0].pose).toBe('alert')
    const busy = ship(snap(repo({ parents: [boss({ status: 'idle' })], children: [kid('a1')] })), { agents: { [P1]: working('t') } })
    expect(busy.decks[0].captains[0].pose).toBe('busy')
    expect(ship(snap(repo({ parents: [boss({ status: 'busy' })], children: [kid('a1')] }))).decks[0].captains[0].pose).toBe('busy')
    expect(ship(snap(repo({ parents: [boss()], children: [kid('a1')] }))).decks[0].captains[0].pose).toBe('idle')
  })

  it('gives a captain its topic, its action while busy, and its held notices', () => {
    const feed = feedOf({
      [P1]: sf({ topic: 'build the ship piece', activity: { tool: 'Bash', target: 'mnemo dispatch', at: NOW - 5 * SEC, running: false }, said: { text: 'Dispatching four pieces now.', at: NOW - MIN } }),
    })
    const kids = [kid('a1', { notice: 'held', live: false, state: 'stopped', updated_at: iso(5 * MIN) }), kid('a2', { notice: 'delivered', live: false, state: 'stopped', updated_at: iso(5 * MIN) }), kid('a3')]
    const cap = ship(snap(repo({ parents: [boss({ status: 'busy' })], children: kids })), { feed }).decks[0].captains[0]
    expect([cap.topic, cap.action, cap.notices]).toEqual(['build the ship piece', '⌘ Bash · mnemo dispatch', 1])
    const idle = ship(snap(repo({ parents: [boss()], children: kids })), { feed }).decks[0].captains[0]
    expect(idle.action).toBeNull()
  })

  it('hands out emblems in order of first sight within each repo', () => {
    const s = ship(
      snap(repo({ parents: [boss(), boss({ session_id: P2 })], children: [kid('a1'), kid('a2', { parent_session: P2 })] }), repo({ root: MNEMO, name: 'mnemo', parents: [boss({ session_id: P3, cwd: MNEMO })] })),
      { firstSeen: { [P1]: NOW - MIN, [P2]: NOW - 2 * MIN, [P3]: NOW - 3 * MIN } },
    )
    const em = Object.fromEntries([...s.decks.flatMap((d) => d.captains), ...s.docks.flatMap((d) => d.captains)].map((c) => [c.id, c.emblem]))
    expect(em).toEqual({ [P2]: '◆', [P1]: '●', [P3]: '◆' })
  })
})

describe('buildShip: decks and docks', () => {
  it('lays one deck per repo with a child, its rooms by zone, and docks the repos with parents only', () => {
    const kids = [
      kid('w1'),
      kid('s1', { updated_at: iso(20 * MIN) }),
      kid('h1', { live: false, state: 'stopped', updated_at: iso(2 * HOUR), pr: pr(1, { ci: 'pass' }) }),
      kid('h2', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(2, { ci: 'pending' }) }),
    ]
    const s = ship(snap(repo({ parents: [boss(), boss({ session_id: P2 })], children: kids }), repo({ root: MNEMO, name: 'mnemo', parents: [boss({ session_id: P3, cwd: MNEMO })] })), {
      agents: { [sid('w1')]: working(), [sid('s1')]: working() },
    })
    expect(s.decks).toHaveLength(1)
    const d = s.decks[0]
    expect([d.root, d.name]).toEqual([ROOT, 'mnemo-desktop'])
    expect(d.flight.map((r) => r.id)).toEqual(['w1'])
    expect(d.stranded.map((r) => r.id)).toEqual(['s1'])
    expect(d.hangar.map((r) => r.id)).toEqual(['h2', 'h1'])
    expect(d.hangarReady).toBe(true)
    expect(d.captains.map((c) => c.id)).toEqual([P1])
    expect(d.quiet.map((c) => c.id)).toEqual([P2])
    expect(s.docks.map((x) => [x.root, x.captains.map((c) => c.id)])).toEqual([[MNEMO, [P3]]])
    expect(s.counts).toEqual({ working: 1, need: 0, ready: 2 })
  })

  it('puts a busy parent with no child among the captains', () => {
    const s = ship(snap(repo({ parents: [boss(), boss({ session_id: P2, status: 'busy' })], children: [kid('a1')] })))
    expect(s.decks[0].captains.map((c) => c.id).sort()).toEqual([P1, P2].sort())
    expect(s.decks[0].quiet).toEqual([])
  })

  it('folds <repo>-wt-* groups into their repo', () => {
    const wt = repo({ root: `${ROOT}-wt-c-ship`, name: 'mnemo-desktop-wt-c-ship', children: [kid('a1')] })
    const s = ship(snap(repo({ parents: [boss()] }), wt))
    expect(s.decks.map((d) => [d.root, d.name])).toEqual([[ROOT, 'mnemo-desktop']])
    expect(s.docks).toEqual([])
  })

  it('puts the repos with the most children first, then by name', () => {
    const m = (id: string) => kid(id, { cwd: `${MNEMO}-wt-${id}`, parent_session: P3 })
    const two = ship(snap(repo({ parents: [boss()], children: [kid('a1')] }), repo({ root: MNEMO, name: 'mnemo', parents: [boss({ session_id: P3, cwd: MNEMO })], children: [m('b1'), m('b2')] })))
    expect(two.decks.map((d) => d.name)).toEqual(['mnemo', 'mnemo-desktop'])
    const tie = ship(snap(repo({ parents: [boss()], children: [kid('a1')] }), repo({ root: MNEMO, name: 'mnemo', parents: [boss({ session_id: P3, cwd: MNEMO })], children: [m('b1')] })))
    expect(tie.decks.map((d) => d.name)).toEqual(['mnemo', 'mnemo-desktop'])
  })

  it('stands a child with its captain’s deck', () => {
    const c = kid('a1', { cwd: `${MNEMO}-wt-1` })
    const s = ship(snap(repo({ parents: [boss()] }), repo({ root: MNEMO, name: 'mnemo', children: [c] })))
    expect(s.decks.map((d) => [d.name, d.flight.map((r) => r.id)])).toEqual([['mnemo-desktop', ['a1']]])
    // It still carries its own repo, for the merge root and the breadcrumbs.
    expect(robot(s, 'a1').child.cwd).toBe(`${MNEMO}-wt-1`)
  })
})

describe('buildShip: the bridge', () => {
  it('orders exceptions need, red, land, ready (longest wait first, a green draft too), stranded (longest first)', () => {
    const done = (id: string, n: number, ago_: number, ci: Pr['ci'], extra: Partial<Pr> = {}) =>
      kid(id, { live: false, state: 'stopped', updated_at: iso(ago_), pr: pr(n, { ci, ...extra }) })
    const kids = [
      kid('s1', { updated_at: iso(20 * MIN) }),
      kid('s2', { updated_at: iso(40 * MIN) }),
      done('r1', 1, HOUR, 'pass'),
      done('r2', 2, 2 * HOUR, 'pass'),
      done('c1', 6, 3 * HOUR, 'none'),
      done('d1', 3, HOUR, 'pass', { draft: true }),
      done('x1', 4, HOUR, 'fail'),
      done('p1', 5, HOUR, 'pending'),
      kid('n1', { tempo: 'blocked', needs: 'which?' }),
    ]
    const mission: Mission = { feature: 'nexus-v2', contract_path: `${ROOT}/docs/c.md`, landable: true, pieces: [] }
    const s = ship(snap(repo({ parents: [boss()], children: kids, missions: [mission] })), { agents: { [sid('s1')]: working(), [sid('s2')]: working() } })
    expect(s.bridge.exceptions.map((e) => [e.kind, 'robotId' in e ? e.robotId : 'root' in e ? e.root : 'captainId' in e ? e.captainId : e.text])).toEqual([
      ['need', 'n1'],
      ['red', 'x1'],
      ['land', ROOT],
      ['ready', 'r2'],
      ['ready', 'd1'],
      ['ready', 'r1'],
      ['stranded', 's2'],
      ['stranded', 's1'],
    ])
    const ready = s.bridge.exceptions.find((e) => e.kind === 'ready')
    expect(ready && 'waitingMs' in ready ? ready.waitingMs : null).toBe(2 * HOUR)
    expect(s.bridge.blocked.map((r) => r.id)).toEqual(['n1'])
    // A PR without checks waits in the hangar with no row: the merge gate would refuse it.
    expect(robot(s, 'c1').zone).toBe('hangar')
  })

  it('reads calm when nothing waits, and carries the fleet’s rate', () => {
    const rate = { callsPerMin: 4, outPerMin: 1200, inPerMin: 90_000, cacheShare: 0.9 }
    const s = ship(snap(repo({ parents: [boss()], children: [kid('a1')] })), { feed: { ...feedOf(), rate } })
    expect(s.bridge).toEqual({ exceptions: [], blocked: [] })
    expect([s.rate, s.at]).toEqual([rate, NOW])
  })
})

describe('buildShip: purity', () => {
  it('gives the same ship for the same input', () => {
    const input: ShipInput = {
      snapshot: snap(repo({ parents: [boss()], children: [kid('a1'), kid('b1', { tempo: 'blocked', needs: 'q' }), kid('c1', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(3) })] })),
      feed: feedOf({ a1: sf({ said: { text: 'Working on it now.', at: NOW - MIN } }) }),
      agents: {},
      events: [],
      firstSeen: {},
      now: NOW,
    }
    expect(buildShip(input)).toEqual(buildShip(input))
  })

  it('is empty for an empty fleet', () => {
    expect(ship(snap())).toEqual({ bridge: { exceptions: [], blocked: [] }, decks: [], docks: [], counts: { working: 0, need: 0, ready: 0 }, rate: null, at: NOW })
  })

  it('leaves the stranded threshold at 15 min', () => {
    expect(robot(one(kid('a1', { updated_at: iso(STRANDED_MS - SEC) }), { agents: {} }), 'a1').zone).toBe('flight')
    expect(robot(one(kid('a1', { updated_at: iso(STRANDED_MS + SEC) }), { agents: {} }), 'a1').zone).toBe('stranded')
  })
})

describe('a captain waiting on you', () => {
  const waits = (waitingFor: AgentView['waitingFor'], title = 'fleet lead'): AgentView => ({ state: 'needs-you', waitingFor, title })

  it('on a permission is one exception, and counts as needing you', () => {
    const s = ship(snap(repo({ parents: [boss()] })), { agents: { [P1]: waits('permission') } })
    expect(s.bridge.exceptions).toEqual([{ kind: 'captain', captainId: P1, waitsOn: 'permission', question: null, since: null, lines: [] }])
    expect(s.bridge.blocked).toEqual([])
    expect(s.counts.need).toBe(1)
    expect(s.docks[0].captains[0].pose).toBe('alert')
  })

  it('on a question carries the feed’s question, and its last tool and sentence as its lines', () => {
    const feed = feedOf({
      [P1]: sf({
        said: { text: 'Two ways to do this, and they differ on the schema.', at: NOW - 3 * MIN },
        activity: { tool: 'AskUserQuestion', target: 'Which schema?', at: NOW - 2 * MIN, running: true },
        ask: { question: 'Which schema?', options: ['v1', 'v2'] },
      }),
    })
    const s = ship(snap(repo({ parents: [boss()] })), { agents: { [P1]: waits('question') }, feed })
    expect(s.bridge.exceptions).toEqual([
      {
        kind: 'captain',
        captainId: P1,
        waitsOn: 'question',
        question: 'Which schema?',
        since: NOW - 2 * MIN,
        lines: ['Two ways to do this, and they differ on the schema.', '? AskUserQuestion · Which schema?'],
      },
    ])
  })

  it('reads its claude agents row without a fleet view, as the sidebar does', () => {
    const asks = (waiting_for: string | null) => ship(snap(repo({ parents: [boss({ status: 'waiting', waiting_for })] }))).bridge.exceptions
    expect(asks('permission prompt')).toMatchObject([{ kind: 'captain', waitsOn: 'permission' }])
    expect(asks('input needed')).toMatchObject([{ kind: 'captain', waitsOn: 'question' }])
    expect(asks('dialog open')).toEqual([])
    expect(ship(snap(repo({ parents: [boss({ status: 'busy' })] }))).bridge.exceptions).toEqual([])
  })

  it('is not an exception while working, idle, or when only its crew waits', () => {
    const blocked = kid('n1', { tempo: 'blocked', needs: 'which?' })
    const s = ship(snap(repo({ parents: [boss()], children: [blocked] })), { agents: { [P1]: working('fleet lead') } })
    expect(s.bridge.exceptions.map((x) => x.kind)).toEqual(['need'])
    expect(s.counts.need).toBe(1)
    expect(s.decks[0].captains[0].pose).toBe('alert')
  })

  it('waits with the children’s needs, longest first; an undated wait has just begun', () => {
    const blocked = kid('n1', { tempo: 'blocked', needs: 'which?', updated_at: iso(4 * MIN) })
    const parents = [boss(), boss({ session_id: P2 }), boss({ session_id: P3 })]
    const feed = feedOf({
      [P1]: sf({ activity: { tool: 'Bash', target: 'git push', at: NOW - 9 * MIN, running: true } }),
      [P2]: sf({ activity: { tool: 'Bash', target: 'rm -rf build', at: NOW - MIN, running: true } }),
    })
    const s = ship(snap(repo({ parents, children: [blocked] })), { agents: { [P1]: waits('permission'), [P2]: waits('permission'), [P3]: waits('question') }, feed })
    expect(s.bridge.exceptions.map((x) => [x.kind, x.kind === 'captain' ? x.captainId : 'robotId' in x ? x.robotId : null])).toEqual([
      ['captain', P1],
      ['need', 'n1'],
      ['captain', P2],
      ['captain', P3],
    ])
    expect(s.counts.need).toBe(4)
  })

  it('comes before the other exceptions', () => {
    const red = kid('x1', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(4, { ci: 'fail' }) })
    const s = ship(snap(repo({ parents: [boss()], children: [red] })), { agents: { [P1]: waits('permission') } })
    expect(s.bridge.exceptions.map((x) => x.kind)).toEqual(['captain', 'red'])
  })
})

describe('what the snapshot could not read', () => {
  const NO_CLAUDE = 'claude agents: No such file or directory (os error 2)'
  const GH_OUT = 'gh pr list: To get started with GitHub CLI, please run:  gh auth login'
  const asks: AgentView = { state: 'needs-you', waitingFor: 'permission', title: 'fleet lead' }

  it('is one exception per error, in order, with what failed, what to do and the line', () => {
    const xs = snapshotExceptions([explainError(NO_CLAUDE), explainError(GH_OUT)])
    expect(xs).toEqual([
      { kind: 'snapshot', source: 'sessions', text: expect.stringMatching(/^Claude sessions could not be listed: `claude` was not found\. Install Claude Code/), detail: NO_CLAUDE },
      { kind: 'snapshot', source: 'prs', text: 'Pull requests could not be read: gh is not logged in. Run `gh auth login` in a terminal.', detail: GH_OUT },
    ])
  })

  it('says each error once', () => {
    expect(snapshotExceptions([explainError(GH_OUT), explainError(GH_OUT)])).toHaveLength(1)
    expect(snapshotExceptions([])).toEqual([])
  })

  it('comes last on the bridge, from every source, without counting as needing you', () => {
    const red = kid('x1', { live: false, state: 'stopped', updated_at: iso(HOUR), pr: pr(4, { ci: 'fail' }) })
    const errors = [NO_CLAUDE, 'history (projects): permission denied', 'agents json: expected value', 'account work: mnemo sessions: boom']
    const s = ship({ ...snap(repo({ parents: [boss()], children: [red] })), errors }, { agents: { [P1]: asks } })
    expect(s.bridge.exceptions.map((x) => [x.kind, x.kind === 'snapshot' ? x.source : null])).toEqual([
      ['captain', null],
      ['red', null],
      ['snapshot', 'sessions'],
      ['snapshot', 'history'],
      ['snapshot', 'sessions'],
      ['snapshot', 'children'],
    ])
    expect(s.counts.need).toBe(1)
    const named = s.bridge.exceptions.at(-1)
    expect(named?.kind === 'snapshot' && named.text).toMatch(/^Background children could not be listed on account work: /)
  })
})

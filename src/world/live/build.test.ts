import { rosterOrder, roots, sessionOf } from '../store'
import type { Session, World } from '../types'
import { buildWorld, EVENTS_MAX } from './build'
import { child, CHILD, fate, feedOf, input, insight, iso, MIN, NOW, parent, PARENT, pr, pulse, repo, ROOT } from './fixtures'
import type { LiveInput } from './input'
import { KEEP_ENDED_MS } from './roster'

const HOUR = 60 * MIN
const CID = CHILD.slice(0, 8)

const build = (over: Parameters<typeof input>[0] = {}, prev: World | null = null) => buildWorld(input(over), prev)
/** The world of one parent and the children given. */
const withChildren = (children: ReturnType<typeof child>[], over: Partial<LiveInput> = {}) => build({ repos_: [repo({ children })], ...over })
const one = (world: World, id: string): Session => {
  const s = sessionOf(world, id)
  if (!s) throw new Error(`no session ${id} in the world: ${world.sessions.map((x) => x.id).join(', ')}`)
  return s
}
const stateOf = (c: ReturnType<typeof child>, over: Partial<LiveInput> = {}) => one(withChildren([c], over), c.session_id ?? c.id).state
const waiting = (world: World, id: string) => world.pending.filter((p) => p.session === id)

describe('what a parent is to the maintainer', () => {
  const stateOfParent = (over: Parameters<typeof parent>[0], more: Partial<LiveInput> = {}) => one(build({ repos_: [repo({ parents: [parent(over)] })], ...more }), PARENT).state

  test('busy is working, idle is idle, waiting on a prompt is a need', () => {
    expect(stateOfParent({ status: 'busy' })).toBe('working')
    expect(stateOfParent({ status: 'idle' })).toBe('idle')
    expect(stateOfParent({ status: 'waiting', waiting_for: 'permission prompt' })).toBe('need')
  })

  test('a dialog the maintainer opened himself asks nothing of him', () => {
    const world = build({ repos_: [repo({ parents: [parent({ status: 'waiting', waiting_for: 'dialog open' })] })] })
    expect(one(world, PARENT).state).toBe('idle')
    expect(world.pending).toEqual([])
  })

  test('what a hook just said wins over the row the last poll read', () => {
    expect(stateOfParent({ status: 'idle' }, { agents: { [PARENT]: { state: 'working', waitingFor: null, title: '' } } })).toBe('working')
    expect(stateOfParent({ status: 'busy' }, { agents: { [PARENT]: { state: 'needs-you', waitingFor: 'question', title: '' } } })).toBe('need')
    expect(stateOfParent({ status: 'busy' }, { agents: { [PARENT]: { state: 'done', waitingFor: null, title: '' } } })).toBe('idle')
  })

  test('its question waits with its choices, a digit each from 1', () => {
    const world = build({
      repos_: [repo({ parents: [parent({ status: 'waiting', waiting_for: 'input needed' })] })],
      feed: { sessions: { [PARENT]: feedOf({ ask: { question: 'Backfill online or in a window?', options: ['Online', 'Window'] } }) }, prs: {} },
    })
    const [item] = waiting(world, PARENT)
    expect(item.kind).toBe('question')
    expect(item.text).toBe('Backfill online or in a window?')
    expect(item.choices.map((c) => [c.key, c.label])).toEqual([[1, 'Online'], [2, 'Window']])
    expect(item.reply).toBe(true)
  })

  test('its permission prompt names the call still awaiting its result', () => {
    const world = build({
      repos_: [repo({ parents: [parent({ status: 'waiting', waiting_for: 'permission prompt' })] })],
      feed: { sessions: { [PARENT]: feedOf({ activity: { tool: 'Bash', target: 'git push origin main', at: NOW - 2 * MIN, running: true } }) }, prs: {} },
    })
    const [item] = waiting(world, PARENT)
    expect(item.kind).toBe('permission')
    expect(item.text).toBe('Allow Bash?')
    expect(item.detail).toBe('git push origin main')
    expect(item.choices.map((c) => c.label)).toEqual(['Allow once', 'Always allow', 'Deny'])
    expect(item.since).toBe(NOW - 2 * MIN)
  })
})

describe('what a child is to the maintainer', () => {
  test('one that acted in the last 150 s is working', () => {
    expect(stateOf(child({ updated_at: iso(NOW - 2 * MIN) }))).toBe('working')
    expect(stateOf(child({ updated_at: iso(NOW - 3 * MIN) }))).toBe('idle')
  })

  test('a tool call awaiting its result is work, not a stop, for as long as three hours', () => {
    const running = (ago: number) => ({ feed: { sessions: { [CID]: feedOf({ activity: { tool: 'Bash', target: 'gh pr checks --watch', at: NOW - ago, running: true } }) }, prs: {} } })
    const quiet = child({ updated_at: iso(NOW - 40 * MIN) })
    expect(stateOf(quiet, running(40 * MIN))).toBe('working')
    expect(stateOf(quiet, running(2 * HOUR + 59 * MIN))).toBe('working')
    // Older than that, it is a call that will never answer.
    expect(stateOf(child({ updated_at: iso(NOW - 4 * HOUR) }), running(4 * HOUR))).toBe('stalled')
  })

  test('idle for 15 minutes with nothing running is stalled, and waits with resume and stop', () => {
    expect(stateOf(child({ updated_at: iso(NOW - 15 * MIN) }))).toBe('idle')
    const world = withChildren([child({ updated_at: iso(NOW - 16 * MIN), detail: 'running the route tests' })])
    expect(one(world, CHILD).state).toBe('stalled')
    const [item] = waiting(world, CHILD)
    expect(item.kind).toBe('stalled')
    expect(item.text).toBe('running the route tests')
    expect(item.choices.map((c) => c.label)).toEqual(['Try again', 'Stop it'])
  })

  test('a child nothing dates is never stalled for want of a time', () => {
    // mnemo says it is at work and nothing says since when: it is taken at its word.
    expect(stateOf(child({ updated_at: null }))).toBe('working')
  })

  test('one whose pull request is open waits for the merge, never stalled', () => {
    expect(stateOf(child({ updated_at: iso(NOW - 3 * HOUR), pr: pr() }))).toBe('ready')
    expect(stateOf(child({ live: false, state: 'done', updated_at: iso(NOW - 3 * HOUR), pr: pr() }))).toBe('ready')
    // Merged since, as the feed knows before the snapshot's next read of GitHub.
    expect(stateOf(child({ live: false, state: 'done', pr: pr() }), { feed: { sessions: {}, prs: { [pr().url]: fate({ state: 'MERGED', mergedAt: NOW - MIN }) } } })).toBe('ended')
  })

  test('over with nothing open is ended; gone without saying it finished is stalled', () => {
    expect(stateOf(child({ live: false, state: 'done' }))).toBe('ended')
    expect(stateOf(child({ live: false, state: 'stopped' }))).toBe('ended')
    expect(stateOf(child({ live: true, state: 'done' }))).toBe('ended')
    expect(stateOf(child({ live: false, state: 'working' }))).toBe('stalled')
    expect(stateOf(child({ live: false, state: 'failed' }))).toBe('stalled')
  })

  test('an unanswered question is a need, with its choices', () => {
    const world = withChildren([child()], { feed: { sessions: { [CID]: feedOf({ ask: { question: 'Which column?', options: ['created_at', 'id'] } }) }, prs: {} } })
    expect(one(world, CHILD).state).toBe('need')
    const [item] = waiting(world, CHILD)
    expect(item).toMatchObject({ kind: 'question', text: 'Which column?', session: CHILD })
    expect(item.choices.map((c) => c.label)).toEqual(['created_at', 'id'])
  })

  test('a question in the transcript of a child that is over asks nobody', () => {
    const world = withChildren([child({ live: false, state: 'done' })], { feed: { sessions: { [CID]: feedOf({ ask: { question: 'Which column?', options: [] } }) }, prs: {} } })
    expect(one(world, CHILD).state).toBe('ended')
    expect(world.pending).toEqual([])
  })

  test('a permission it waits on is answered with allow once, always, deny, and says the command', () => {
    const world = withChildren([child({ tempo: 'blocked', needs: 'approve Bash: git push origin fix/issue-412', waiting_for: 'permission prompt' })])
    expect(one(world, CHILD).state).toBe('need')
    const [item] = waiting(world, CHILD)
    expect(item.kind).toBe('permission')
    expect(item.text).toBe('Allow Bash?')
    expect(item.detail).toBe('git push origin fix/issue-412')
    expect(item.choices.map((c) => c.label)).toEqual(['Allow once', 'Always allow', 'Deny'])
  })

  test('a block in words is answered in words, with the reply the child suggests', () => {
    const world = withChildren([child({ tempo: 'blocked', needs: 'Which of the two schemas is the current one?', suggested_reply: 'The v2 one.' })])
    const [item] = waiting(world, CHILD)
    expect(item).toMatchObject({ kind: 'blocked', text: 'Which of the two schemas is the current one?', suggestedReply: 'The v2 one.', reply: true })
  })

  test('blocked with no process behind it is a need nobody can hear the answer to: abandoned', () => {
    const world = withChildren([child({ live: false, state: 'blocked', tempo: 'blocked', needs: 'approve Bash: rm -rf build', updated_at: iso(NOW - 90 * HOUR) })])
    const s = one(world, CHILD)
    expect(s.state).toBe('need')
    expect(s.abandoned).toBe(true)
    // No prompt is on any screen: it is answered like a block, not with allow and deny.
    expect(waiting(world, CHILD)[0].kind).toBe('blocked')
    expect(one(withChildren([child({ tempo: 'blocked', needs: 'approve Bash: ls' })]), CHILD).abandoned).toBe(false)
  })

  test('a child stopped by the plan’s limit does not ask for the maintainer', () => {
    const limited = child({ tempo: 'blocked', needs: 'rate limited — wait and retry', updated_at: iso(NOW - 5 * MIN) })
    expect(stateOf(limited)).toBe('idle')
    expect(withChildren([limited]).pending).toEqual([])
  })
})

describe('a pull request that waits', () => {
  const ready = (over: Parameters<typeof pr>[0], more: Partial<LiveInput> = {}) => withChildren([child({ live: false, state: 'done', pr: pr(over) })], more)

  test('green is a merge to make', () => {
    const [item] = ready({ ci: 'pass' }).pending
    expect(item.kind).toBe('merge')
    expect(item.detail).toBe('acme/atlas#77')
    expect(item.pr).toMatchObject({ number: 77, repo: 'acme/atlas', state: 'open', ci: 'green' })
    expect(item.choices.map((c) => c.label)).toEqual(['Merge', 'Send back'])
    expect(item.reply).toBe(false)
  })

  test('still running is a merge that waits for green', () => {
    expect(ready({ ci: 'pending' }).pending[0].choices[0].label).toBe('Merge when green')
  })

  test('red CI is not a need while mnemo’s follow wakes the child to fix it', () => {
    const world = ready({ ci: 'fail' })
    expect(one(world, CHILD).state).toBe('ready')
    expect(one(world, CHILD).prs[0].ci).toBe('red')
    expect(world.pending).toEqual([])
  })

  test('the checks the feed read say where CI stands now', () => {
    const checks = (conclusion: string | null, done: boolean) => ({ feed: { sessions: {}, prs: { [pr().url]: fate({ checks: [{ name: 'test', startedAt: NOW - 5 * MIN, completedAt: done ? NOW - MIN : null, conclusion }] }) } } })
    expect(one(ready({ ci: 'pending' }, checks('SUCCESS', true)), CHILD).prs[0].ci).toBe('green')
    expect(one(ready({ ci: 'pass' }, checks('FAILURE', true)), CHILD).prs[0].ci).toBe('red')
    expect(one(ready({ ci: 'pass' }, checks(null, false)), CHILD).prs[0].ci).toBe('running')
  })
})

describe('what waits', () => {
  test('is listed oldest first, one nothing dates last', () => {
    const world = withChildren([
      child({ id: 'k1', tempo: 'blocked', needs: 'first?', updated_at: iso(NOW - 30 * MIN) }),
      child({ id: 'k2', tempo: 'blocked', needs: 'second?', updated_at: iso(NOW - 50 * MIN) }),
      child({ id: 'k3', tempo: 'blocked', needs: 'undated?', updated_at: null }),
    ])
    expect(world.pending.map((p) => p.text)).toEqual(['second?', 'first?', 'undated?'])
  })

  test('keeps its id while it waits, and gets another when what it asks changes', () => {
    const asking = (question: string) => withChildren([child()], { feed: { sessions: { [CID]: feedOf({ ask: { question, options: ['yes', 'no'] } }) }, prs: {} } }).pending[0].id
    expect(asking('Rebase first?')).toBe(asking('Rebase first?'))
    expect(asking('Rebase first?')).not.toBe(asking('Squash them?'))
  })
})

describe('families', () => {
  test('a child stands under the parent the snapshot gives it, and a grandchild under the child', () => {
    const kid = child({ id: 'kid00001' })
    const grandkid = child({ id: 'grand001', parent_session: kid.session_id })
    const world = withChildren([kid, grandkid])
    expect(one(world, PARENT).children).toEqual([kid.session_id])
    expect(one(world, kid.session_id!).parent).toBe(PARENT)
    expect(one(world, kid.session_id!).children).toEqual([grandkid.session_id])
    expect(one(world, grandkid.session_id!).parent).toBe(kid.session_id)
    expect(roots(world).map((s) => s.id)).toEqual([PARENT])
    expect(rosterOrder(world).map((s) => s.id)).toContain(kid.session_id)
  })

  test('a parent that is gone is still there, ended, holding the children that name it', () => {
    const gone = 'dddddddd-0000-4000-8000-000000000009'
    const world = withChildren([child({ parent_session: gone })])
    const s = one(world, gone)
    expect(s).toMatchObject({ role: 'parent', live: false, state: 'ended', children: [CHILD], project: 'atlas' })
    expect(roots(world).map((x) => x.id).sort()).toEqual([PARENT, gone].sort())
  })

  test('a child with no recorded parent is its own root', () => {
    const world = withChildren([child({ parent_session: null })])
    expect(one(world, CHILD).parent).toBeNull()
    expect(roots(world).map((s) => s.id).sort()).toEqual([PARENT, CHILD].sort())
  })

  test('a child that names itself as its parent is its own root', () => {
    for (const self of [CHILD, CID]) {
      const world = withChildren([child({ parent_session: self })])
      expect(one(world, CHILD).parent).toBeNull()
      expect(roots(world).map((s) => s.id)).toContain(CHILD)
    }
  })

  test('two children that name each other are both still drawn', () => {
    const a = child({ id: 'ring0001', parent_session: 'ring0002-0000-4000-8000-000000000001' })
    const b = child({ id: 'ring0002', parent_session: 'ring0001-0000-4000-8000-000000000001' })
    const world = withChildren([a, b])
    const drawn = rosterOrder(world).map((s) => s.id)
    expect(drawn).toContain(a.session_id)
    expect(drawn).toContain(b.session_id)
  })

  test('a session listed both ways is the child', () => {
    const world = build({ repos_: [repo({ parents: [parent(), parent({ session_id: CHILD })], children: [child()] })] })
    expect(world.sessions.filter((s) => s.id === CHILD).map((s) => s.role)).toEqual(['child'])
  })

  test('a contract piece is one child, with its piece’s pull request', () => {
    const piece = child({ pr: null, live: false, state: 'done' })
    const world = build({ repos_: [repo({ missions: [{ feature: 'orders', contract_path: 'docs/contracts/orders.md', landable: false, pieces: [{ name: 'api', branch: 'feat/orders/api', child: piece, pr: pr({ number: 90, url: 'https://github.com/acme/atlas/pull/90' }) }] }], children: [piece] })] })
    expect(world.sessions.filter((s) => s.id === CHILD)).toHaveLength(1)
    expect(one(world, CHILD)).toMatchObject({ contract: { feature: 'orders', piece: 'api' }, state: 'ready' })
    expect(one(world, CHILD).prs.map((p) => p.number)).toEqual([90])
  })

  test('a tree’s tokens are the session’s and its children’s', () => {
    const row = (n: number) => ({ input: n, output: n, cacheRead: n, cacheCreation: n, thinking: 0 })
    const tokens = (n: number) => ({ main: row(n), sidechain: row(0), subagents: [], byModel: {}, own: row(n) })
    const world = withChildren([child()], { insights: { [PARENT]: insight({ tokens: tokens(100) }), [CID]: insight({ tokens: tokens(7) }) } })
    expect(one(world, PARENT).totals).toEqual({ own: row(100), tree: row(107) })
    expect(one(world, CHILD).totals).toEqual({ own: row(7), tree: row(7) })
  })

  test('a worktree’s sessions belong to its repo’s project', () => {
    const world = build({ repos_: [repo(), repo({ root: `${ROOT}-wt-412`, name: 'atlas-wt-412', parents: [], children: [child()] })] })
    expect(one(world, CHILD)).toMatchObject({ project: 'atlas', root: ROOT, issue: 412 })
    expect(world.projects.map((p) => [p.name, p.sessions.length])).toEqual([['atlas', 2]])
  })
})

describe('who is in the world', () => {
  test('an ended child leaves 48 hours after its last sign of life', () => {
    const ended = (ago: number, over: Parameters<typeof child>[0] = {}) => withChildren([child({ live: false, state: 'done', updated_at: iso(NOW - ago), ...over })]).sessions.some((s) => s.id === CHILD)
    expect(ended(KEEP_ENDED_MS - MIN)).toBe(true)
    expect(ended(KEEP_ENDED_MS + MIN)).toBe(false)
    expect(ended(0, { updated_at: null })).toBe(false)
  })

  test('one whose pull request is still open, or that still waits, stays however old', () => {
    const old = { live: false, updated_at: iso(NOW - 10 * KEEP_ENDED_MS) }
    expect(withChildren([child({ ...old, state: 'done', pr: pr() })]).sessions.map((s) => s.id)).toContain(CHILD)
    expect(withChildren([child({ ...old, state: 'done', pr: pr({ state: 'MERGED' }) })]).sessions.map((s) => s.id)).not.toContain(CHILD)
    expect(withChildren([child({ ...old, state: 'blocked', tempo: 'blocked', needs: 'which one?' })]).sessions.map((s) => s.id)).toContain(CHILD)
  })

  test('sessions are listed newest activity first', () => {
    const world = withChildren([child({ id: 'old00001', updated_at: iso(NOW - 50 * MIN) }), child({ id: 'new00001', updated_at: iso(NOW - MIN) })], {
      feed: { sessions: { [PARENT]: feedOf({ said: { text: 'Done.', at: NOW - 10 * MIN } }) }, prs: {} },
    })
    expect(world.sessions.map((s) => s.short)).toEqual(['new00001', PARENT.slice(0, 8), 'old00001'])
  })
})

describe('what is known of a session', () => {
  test('before the insight answers: the feed’s last call, its context and what it said', () => {
    const world = build({
      feed: { sessions: { [PARENT]: feedOf({ activity: { tool: 'Bash', target: 'pnpm test', at: NOW - MIN, running: true }, said: { text: 'Running the suite.', at: NOW - 2 * MIN }, context: 150_000, model: 'claude-opus-5', topic: 'run the tests', title: 'Order history' }) }, prs: {} },
    })
    const s = one(world, PARENT)
    expect(s.title).toBe('Order history')
    expect(s.activity).toEqual([{ at: NOW - MIN, tool: 'Bash', kind: 'shell', target: 'pnpm test', running: true, ok: null, ms: null }])
    expect(s.context).toMatchObject({ tokens: 150_000, window: 200_000, percent: 75 })
    expect(s.said).toEqual({ at: NOW - 2 * MIN, text: 'Running the suite.' })
    expect(s.lastPrompt).toBe('run the tests')
    expect(s.model).toBe('claude-opus-5')
    expect(s.lastAt).toBe(NOW - MIN)
  })

  test('a context past 200k is held against the 1M window', () => {
    const world = build({ feed: { sessions: { [PARENT]: feedOf({ context: 250_000 }) }, prs: {} } })
    expect(one(world, PARENT).context).toMatchObject({ window: 1_000_000, percent: 25 })
  })

  test('once the insight answers, its numbers are the session’s, object for object', () => {
    const read = insight({ title: 'Cursor pagination', turns: 12, context: { tokens: 90_000, window: 200_000, percent: 45, series: [[NOW - HOUR, 10_000]], compactions: [] }, activityTotal: 340, lastAt: NOW - 5_000 })
    const s = one(build({ insights: { [PARENT]: read }, feed: { sessions: { [PARENT]: feedOf({ title: 'a feed title', context: 1 }) }, prs: {} } }), PARENT)
    expect(s.title).toBe('Cursor pagination')
    expect(s.turns).toBe(12)
    expect(s.activityTotal).toBe(340)
    expect(s.context).toBe(read.context)
    expect(s.tokens).toBe(read.tokens)
    expect(s.web).toBe(read.web)
    expect(s.lastAt).toBe(NOW - 5_000)
  })

  test('the rules mnemo gave it are what the app heard, until the core’s trail answers', () => {
    const heard = [pulse({ session_id: PARENT, at: NOW - 3 * MIN }), pulse({ session_id: PARENT, kind: 'tool', tool: 'read_mnemo_rule', slugs: ['retry-with-backoff'], at: NOW - 2 * MIN }), pulse({ session_id: 'someone-else' })]
    const s = one(build({ pulses: heard }), PARENT)
    expect(s.memory.trail.injected.map((r) => [r.at, r.slug])).toEqual([[NOW - 3 * MIN, 'prefer-cursor-pagination']])
    expect(s.memory.trail.read.map((r) => [r.tool, r.slug])).toEqual([['read_mnemo_rule', 'retry-with-backoff']])

    const trail = { prompts: 9, injected: [], considered: [{ at: NOW - MIN, reason: 'judge_none_relevant', candidates: [] }], read: [], briefings: [], frictions: [] }
    expect(one(build({ pulses: heard, trails: { [PARENT]: trail } }), PARENT).memory.trail).toBe(trail)
  })

  test('a terminal the app runs itself is hosted', () => {
    const world = withChildren([child()], { hosted: [PARENT] })
    expect(one(world, PARENT).hosted).toBe(true)
    expect(one(world, CHILD).hosted).toBe(false)
    // The session host knows a child by its short id.
    expect(one(withChildren([child()], { hosted: [CID] }), CHILD).hosted).toBe(true)
  })
})

describe('the rest of the world', () => {
  test('each account carries its plan’s windows, with times in epoch ms', () => {
    const account = (id: string) => ({ id, label: id, configDir: '', isDefault: id === 'default', kind: 'claude' as const, email: null, problem: null, unshared: [] })
    const limit = { kind: 'session', group: 'session', model: null, percent: 41, severity: 'normal', resetsAt: '2026-11-09T23:00:00Z', active: true }
    const world = build({
      accounts: { state: { active: 'work', accounts: [account('default'), account('work')] }, usage: { work: { usage: { plan: 'max', limits: [limit], fetchedAt: NOW, stale: 'read 2 h ago: offline' }, error: null } }, error: null },
    })
    expect(world.accounts.map((a) => [a.id, a.active, a.plan])).toEqual([['default', false, null], ['work', true, 'max']])
    expect(world.accounts[1].limits).toEqual([{ ...limit, resetsAt: Date.parse('2026-11-09T23:00:00Z') }])
    expect(world.accounts[1].stale).toBe('read 2 h ago: offline')
  })

  test('projects are listed most sessions first, then the repos with none', () => {
    const world = build({
      repos_: [repo({ parents: [parent()] }), repo({ root: '/Users/you/code/birch', name: 'birch', parents: [parent({ session_id: 'b1' }), parent({ session_id: 'b2' })] })],
      repos: [{ root: ROOT, name: 'atlas' }, { root: '/Users/you/code/cedar', name: 'cedar' }],
    })
    expect(world.projects.map((p) => [p.name, p.sessions.length])).toEqual([['birch', 2], ['atlas', 1], ['cedar', 0]])
    expect(world.projects[2].root).toBe('/Users/you/code/cedar')
  })

  test('what could not be read is said in words, each once', () => {
    const world = buildWorld({ ...input(), snapshot: { repos: [], errors: ['gh pr list: error connecting to api.github.com', 'gh pr list: error connecting to api.github.com'] }, notes: ['The feed could not be read.'], accounts: { state: null, usage: {}, error: 'no accounts.json' } }, null)
    expect(world.errors).toEqual(['Pull requests could not be read: GitHub could not be reached. Check the connection; it is read again on its own.', 'The feed could not be read.', 'Accounts could not be read: no accounts.json'])
  })

  test('the vault’s recent events are the core’s and what the app heard, each once', () => {
    const core = { rules: 310, prompts: 40, outcomes: { emitted: 12 }, learned: [], recent: [{ at: NOW - 3 * MIN, kind: 'injected' as const, slug: 'prefer-cursor-pagination', sessionId: PARENT, project: 'atlas' }] }
    const heard = [pulse({ session_id: PARENT, at: NOW - 3 * MIN }), pulse({ kind: 'learned', slugs: ['name-the-flag'], at: NOW - MIN })]
    const world = build({ vault: core, pulses: heard })
    expect(world.vault.rules).toBe(310)
    expect(world.vault.recent.map((r) => [r.kind, r.slug])).toEqual([['injected', 'prefer-cursor-pagination'], ['learned', 'name-the-flag']])
    expect(world.vault.learned.map((l) => l.slug)).toEqual(['name-the-flag'])
    expect(build({ pulses: heard }).vault.recent).toHaveLength(2)
  })
})

describe('what happened', () => {
  test('a rule given, a child finished and a pull request merged are events at their own times', () => {
    const done = child({ live: false, state: 'done', updated_at: iso(NOW - 20 * MIN), pr: pr() })
    const world = withChildren([done], {
      pulses: [pulse({ session_id: CHILD, at: NOW - 30 * MIN })],
      feed: { sessions: {}, prs: { [pr().url]: fate({ state: 'MERGED', mergedAt: NOW - 5 * MIN }) } },
    })
    expect(world.events.map((e) => [e.at, e.kind, e.session, e.text])).toEqual([
      [NOW - 30 * MIN, 'rule-injected', CHILD, 'prefer-cursor-pagination'],
      [NOW - 20 * MIN, 'finished', CHILD, 'Fix the order history query'],
      [NOW - 5 * MIN, 'pr-merged', CHILD, '#77'],
    ])
  })

  test('a rule the core’s trail says mnemo gave is an event, heard by the app or not', () => {
    const trail = { prompts: 3, injected: [{ at: NOW - 9 * HOUR, slug: 'name-the-flag', name: 'Name the flag', score: 0.7, judge: 0.9 }], considered: [], read: [{ at: NOW - 8 * HOUR, tool: 'read_mnemo_rule', slug: 'retry-with-backoff', topic: null, query: null, hits: [], ms: 4 }], briefings: [], frictions: [] }
    expect(build({ trails: { [PARENT]: trail } }).events.map((e) => [e.at, e.kind, e.session, e.text])).toEqual([
      [NOW - 9 * HOUR, 'rule-injected', PARENT, 'name-the-flag'],
      [NOW - 8 * HOUR, 'rule-read', PARENT, 'retry-with-backoff'],
    ])
  })

  test('a question that no longer waits was answered, and stays answered', () => {
    const asked = { feed: { sessions: { [CID]: feedOf({ ask: { question: 'Which column?', options: ['a', 'b'] } }) }, prs: {} } }
    const before = withChildren([child()], asked)
    expect(before.events.some((e) => e.kind === 'answered')).toBe(false)
    const after = buildWorld({ ...input({ repos_: [repo({ children: [child()] })] }), now: NOW + 5_000 }, before)
    expect(after.events.filter((e) => e.kind === 'answered')).toEqual([{ at: NOW + 5_000, kind: 'answered', session: CHILD, text: 'Which column?' }])
    const later = buildWorld({ ...input({ repos_: [repo({ children: [child()] })] }), now: NOW + 60_000 }, after)
    expect(later.events.filter((e) => e.kind === 'answered')).toEqual(after.events.filter((e) => e.kind === 'answered'))
  })

  test('a child whose process died unfinished did not finish', () => {
    expect(withChildren([child({ live: false, state: 'working', updated_at: iso(NOW - 20 * MIN) })]).events).toEqual([])
  })

  test('only the newest 600 are kept, oldest first', () => {
    const heard = Array.from({ length: EVENTS_MAX + 50 }, (_, n) => pulse({ session_id: PARENT, slugs: [`rule-${n}`], at: NOW - HOUR + n * 1000 }))
    const { events } = build({ pulses: heard })
    expect(events).toHaveLength(EVENTS_MAX)
    expect(events[0].text).toBe('rule-50')
    expect(events.at(-1)!.text).toBe(`rule-${EVENTS_MAX + 49}`)
  })

  test('a question still waiting is not an answer', () => {
    const asked = { repos_: [repo({ children: [child()] })], feed: { sessions: { [CID]: feedOf({ ask: { question: 'Which column?', options: ['a', 'b'] } }) }, prs: {} } }
    const again = buildWorld({ ...input(asked), now: NOW + 5_000 }, build(asked))
    expect(again.events.some((e) => e.kind === 'answered')).toBe(false)
  })
})

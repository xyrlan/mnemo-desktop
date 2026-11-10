import type { Job } from '../../cockpit/store'
import { shipped } from '../../cockpit/fixtures'
import { contractDispatchKey, dispatchKey } from '../../github/actions'
import { issue, snapWithIssues } from '../../github/fixtures'
import { EMPTY, type HomeRepo, type HomeSnapshot } from '../../home/types'
import { child } from '../../mission/fixtures'
import type { Mission, Snapshot } from '../../mission/types'
import { actOf, flagWords, launchTitle, missionStanding, nextOf, pieceStanding, progressOf, rowsOf, sectionsOf, sessionOfLink } from './model'
import { createLaunchStore, KEPT, NO_FLAGS, optionsOf, type Launch } from './store'

// The cockpit fixtures' mnemo repo: its child `c0ffee01` is on `fix/issue-40`, and its contract
// `round4` is landable.
const ROOT = shipped.root
const repo = (root: string, name: string, over: Partial<HomeRepo> = {}): HomeRepo => ({ root, name, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...over })
const home: HomeSnapshot = {
  ...EMPTY,
  repos: [
    repo(ROOT, 'mnemo', {
      issues: [issue({ number: 1, title: 'first' }), issue({ number: 2, title: 'second', labels: ['ui'] }), issue({ number: 40, title: 'dispatched issue' })],
      prs: [{ number: 12, title: 'api', state: 'open', checks: 'pass', child: 'c0ffee01', url: 'https://github.com/me/mnemo/pull/12' }],
    }),
    // Nothing on GitHub, one mission: listed for the mission alone.
    repo('/Users/me/github/mnemo-desktop', 'mnemo-desktop'),
    repo('/Users/me/notes', 'notes', { issues: [issue({ number: 7, title: 'notes issue' })] }),
    repo('/Users/me/github/hidden', 'hidden', { hidden: true, issues: [issue({ number: 9, title: 'never shown' })] }),
  ],
}
const NONE: Snapshot = { repos: [], errors: [], at: '' }

const launch = (over: Partial<Launch>): Launch => ({ id: 1, kind: 'issues', root: ROOT, repo: 'mnemo', issues: [], path: null, feature: null, options: {}, at: 0, outcome: { ok: true }, ...over })
const job = (over: Partial<Job>): Job => ({ title: 't', lines: [], running: true, code: null, ...over })

describe('what the panel lists', () => {
  test('each repo with something to show, in Home\'s order: a mission alone is enough, a hidden repo never is', () => {
    const s = sectionsOf(home, snapWithIssues, '', null)
    expect(s.map((x) => x.repo.name)).toEqual(['mnemo', 'mnemo-desktop', 'notes'])
    expect(s[1].missions.map((m) => m.feature)).toEqual(['round3'])
    expect(s[1].issues).toEqual([])
  })

  test('the rows the cursor walks: a repo\'s missions, then its issues, then its pull requests', () => {
    const rows = rowsOf(sectionsOf(home, snapWithIssues, '', ROOT))
    expect(rows.map((r) => r.key)).toEqual([`mission:${ROOT}#round4`, `issue:${ROOT}#1`, `issue:${ROOT}#2`, `issue:${ROOT}#40`, `pr:${ROOT}#12`])
    // #40 is already worked on by a child: the row carries what does.
    const flying = rows.find((r) => r.kind === 'issue' && r.issue.number === 40)
    expect(flying?.kind === 'issue' && flying.link?.children.map((c) => c.id)).toEqual(['c0ffee01'])
    expect(rows.find((r) => r.kind === 'issue' && r.issue.number === 1)).toMatchObject({ link: undefined })
  })

  test('a query keeps what matches: an issue by its label, a mission by its feature', () => {
    expect(rowsOf(sectionsOf(home, snapWithIssues, 'ui', null)).map((r) => r.key)).toEqual([`issue:${ROOT}#2`])
    expect(rowsOf(sectionsOf(home, snapWithIssues, 'round3', null)).map((r) => r.key)).toEqual(['mission:/Users/me/github/mnemo-desktop#round3'])
  })
})

describe('what a key does', () => {
  test('Space picks and shift makes it a range; D, Enter, L, O, P and the flag keys each ask one thing', () => {
    expect(actOf({ key: ' ' })).toEqual({ kind: 'pick', range: false })
    expect(actOf({ key: ' ', shiftKey: true })).toEqual({ kind: 'pick', range: true })
    expect(actOf({ key: 'd' })).toEqual({ kind: 'only' })
    expect(actOf({ key: 'Enter' })).toEqual({ kind: 'confirm' })
    expect(actOf({ key: 'L' })).toEqual({ kind: 'land' })
    expect(actOf({ key: 'o' })).toEqual({ kind: 'open' })
    expect(actOf({ key: 'p' })).toEqual({ kind: 'contract' })
    expect(actOf({ key: 'v' })).toEqual({ kind: 'flag', flag: 'advisor' })
    expect(actOf({ key: 'y' })).toEqual({ kind: 'flag', flag: 'may' })
    expect(actOf({ key: 'd', metaKey: true })).toBeNull()
    expect(actOf({ key: 'n' })).toBeNull()
  })

  test('a flag\'s key steps through its values and comes round to off', () => {
    const models = ['', 'haiku', 'sonnet', 'opus']
    expect(nextOf(models, '')).toBe('haiku')
    expect(nextOf(models, 'sonnet')).toBe('opus')
    expect(nextOf(models, 'opus')).toBe('')
  })

  test('a flag left off is not sent', () => {
    expect(optionsOf(NO_FLAGS)).toEqual({})
    expect(optionsOf({ model: 'opus', effort: '', may: 'pr', advisor: 'sonnet' })).toEqual({ model: 'opus', may: 'pr', advisor: 'sonnet' })
  })
})

describe('how a mission stands', () => {
  const m = shipped.missions[0]

  test('a piece is its pull request first: green is ready, red is stalled; with neither child nor PR it has not started', () => {
    expect(m.pieces.map((p) => pieceStanding(p))).toEqual([
      { state: 'ready', word: '#12 checks pass' },
      { state: 'stalled', word: '#13 checks fail' },
      { state: 'idle', word: 'not started' },
    ])
  })

  test('a blocked child comes before its pull request, and a child with no PR says its own word', () => {
    expect(pieceStanding({ name: 'x', branch: 'b', child: child({ id: 'k1', tempo: 'blocked' }), pr: m.pieces[0].pr })).toEqual({ state: 'need', word: 'blocked' })
    expect(pieceStanding({ name: 'x', branch: 'b', child: child({ id: 'k2' }), pr: null })).toEqual({ state: 'working', word: 'active' })
    expect(pieceStanding({ name: 'x', branch: 'b', child: child({ id: 'k3', state: 'done', live: false }), pr: null })).toEqual({ state: 'ended', word: 'done' })
  })

  test('a mission says its pieces and how many have a PR; one that can land says so, one that cannot takes its most urgent piece', () => {
    expect(missionStanding(m)).toEqual({ state: 'ready', word: '3 pieces · 2 with a PR · ready to land' })
    const not: Mission = { ...m, landable: false }
    expect(missionStanding(not)).toEqual({ state: 'stalled', word: '3 pieces · 2 with a PR' })
  })
})

describe('how a launch is going', () => {
  test('a refusal is its reason', () => {
    expect(progressOf(launch({ issues: [1], outcome: { ok: false, why: 'the same dispatch is already running' } }), {}, NONE, home)).toEqual({ state: 'stalled', word: 'the same dispatch is already running', open: null })
  })

  test('before anything answers it is starting; then the job says its last line; then the answer\'s note', () => {
    const l = launch({ issues: [1, 2], outcome: null })
    expect(progressOf(l, {}, NONE, home)).toMatchObject({ state: 'working', word: 'starting…' })
    const jobs = { [dispatchKey(ROOT, [1, 2])]: job({ lines: [{ stream: 'out', line: 'child 1a2b3c4d on fix/issue-1' }] }) }
    expect(progressOf(l, jobs, NONE, home)).toMatchObject({ state: 'working', word: 'child 1a2b3c4d on fix/issue-1' })
    // Another dispatch's job is not this one's.
    expect(progressOf(launch({ issues: [2], outcome: null }), jobs, NONE, home)).toMatchObject({ word: 'starting…' })
    expect(progressOf(launch({ issues: [1], outcome: { ok: true, note: 'The sample world dispatches nothing.' } }), {}, NONE, home)).toMatchObject({ state: 'idle', word: 'The sample world dispatches nothing.' })
    expect(progressOf(launch({ issues: [1], outcome: { ok: true } }), {}, NONE, home)).toMatchObject({ state: 'idle', word: 'dispatched' })
  })

  test('a job that failed is the launch stalled, with what it said', () => {
    const jobs = { [dispatchKey(ROOT, [1])]: job({ running: false, code: 1, error: 'mnemo: not a contract' }) }
    expect(progressOf(launch({ issues: [1] }), jobs, NONE, home)).toMatchObject({ state: 'stalled', word: 'mnemo: not a contract' })
  })

  test('once the snapshot knows the issue\'s child, the launch says how each issue goes and opens the most urgent one\'s session', () => {
    const p = progressOf(launch({ issues: [1, 40] }), {}, snapWithIssues, home)
    expect(p).toEqual({ state: 'working', word: '#40 child active', open: 'c0ffee01' })
    // Blocked is what the maintainer is shown first.
    const blocked: Snapshot = { ...snapWithIssues, repos: snapWithIssues.repos.map((r) => (r.root === ROOT ? { ...r, children: [...r.children.map((c) => ({ ...c, session_id: 'sess-40' })), child({ id: 'b10cced1', branch: 'fix/issue-1', tempo: 'blocked', session_id: 'sess-1' })] } : r)) }
    expect(progressOf(launch({ issues: [1, 40] }), {}, blocked, home)).toEqual({ state: 'need', word: '#1 child blocked · #40 child active', open: 'sess-1' })
  })

  test('a contract is its mission once the snapshot has one, its job\'s last line before', () => {
    const l = launch({ kind: 'contract', path: 'docs/contracts/round4.md' })
    expect(progressOf(l, {}, snapWithIssues, home)).toEqual({ state: 'ready', word: '3 pieces · 2 with a PR · ready to land', open: null })
    const jobs = { [contractDispatchKey(ROOT, 'docs/contracts/new.md')]: job({ lines: [{ stream: 'out', line: 'queue: 3 pieces' }] }) }
    expect(progressOf(launch({ kind: 'contract', path: 'docs/contracts/new.md', outcome: null }), jobs, snapWithIssues, home)).toMatchObject({ state: 'working', word: 'queue: 3 pieces' })
  })

  test('a landing is under way until it answers', () => {
    expect(progressOf(launch({ kind: 'land', feature: 'round4', outcome: null }), {}, snapWithIssues, home)).toMatchObject({ state: 'working' })
    expect(progressOf(launch({ kind: 'land', feature: 'round4', outcome: { ok: true, note: '3 merged' } }), {}, snapWithIssues, home)).toMatchObject({ state: 'ended', word: '3 merged' })
  })

  test('a launch is named by what was asked, and says the flags it carried', () => {
    expect(launchTitle(launch({ issues: [3, 12] }))).toBe('#3, #12')
    expect(launchTitle(launch({ kind: 'contract', path: 'docs/contracts/x.md' }))).toBe('contract docs/contracts/x.md')
    expect(launchTitle(launch({ kind: 'land', feature: 'round4' }))).toBe('land round4')
    expect(flagWords({ model: 'opus', may: 'pr', advisor: 'sonnet' })).toBe('opus · may pr · advisor sonnet')
    expect(flagWords({})).toBe('')
  })

  test('the session behind an issue in flight is its child\'s session, or the child\'s short id before it has one', () => {
    const link = { children: [child({ id: 'c0ffee01' })], pieces: [], prs: [], closing: [] }
    expect(sessionOfLink(link)).toBe('c0ffee01')
    expect(sessionOfLink({ ...link, children: [child({ id: 'c0ffee01', session_id: 'c0ffee01-full' })] })).toBe('c0ffee01-full')
    expect(sessionOfLink({ ...link, children: [] })).toBeNull()
    expect(sessionOfLink(undefined)).toBeNull()
  })
})

describe('what was launched', () => {
  const what = (n: number) => ({ kind: 'issues' as const, root: ROOT, repo: 'mnemo', issues: [n], path: null, feature: null, options: {} })

  test('a launch is listed at once, newest first, and takes its answer when it comes', async () => {
    const store = createLaunchStore(() => 1000)
    let answer: (o: { ok: true; note: string }) => void = () => {}
    const first = store.getState().launch(what(1), () => new Promise((r) => (answer = r)))
    void store.getState().launch(what(2), async () => ({ ok: true }))
    expect(store.getState().launches.map((l) => [l.issues[0], l.outcome])).toEqual([
      [2, null],
      [1, null],
    ])
    answer({ ok: true, note: 'queued' })
    expect(await first).toEqual({ ok: true, note: 'queued' })
    expect(store.getState().launches.map((l) => [l.issues[0], l.outcome, l.at])).toEqual([
      [2, { ok: true }, 1000],
      [1, { ok: true, note: 'queued' }, 1000],
    ])
  })

  test('an action that throws is a refusal with its message', async () => {
    const store = createLaunchStore()
    const out = await store.getState().launch(what(1), async () => Promise.reject(new Error('no core')))
    expect(out).toEqual({ ok: false, why: 'no core' })
    expect(store.getState().launches[0].outcome).toEqual({ ok: false, why: 'no core' })
  })

  test('only the newest are kept, and one can be taken off the list', async () => {
    const store = createLaunchStore()
    for (let n = 1; n <= KEPT + 3; n++) await store.getState().launch(what(n), async () => ({ ok: true }))
    const kept = store.getState().launches
    expect(kept.length).toBe(KEPT)
    expect(kept[0].issues).toEqual([KEPT + 3])
    store.getState().forget(kept[0].id)
    expect(store.getState().launches.map((l) => l.issues[0])).not.toContain(KEPT + 3)
    expect(store.getState().launches.length).toBe(KEPT - 1)
  })
})

import { describe, expect, it } from 'vitest'
import { child, parent } from '../mission/fixtures'
import type { ChildSession, ParentSession, Pr, RepoGroup, Snapshot } from '../mission/types'
import { ACCESSORIES, type ArchiveCounts, type Robot, type World } from './types'
import { accessoryOf, buildWorld, classOf, EXIT_MS, isRateLimited, labelOf, levelOf, prBadge, robotOf, tierOf, TIER_FULL, TIER_GROWN, toolOf, UNKNOWN_PARENT } from './world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

const ROOT = '/Users/me/github/mnemo-desktop'
const P1 = '0ff9d810-aaaa-4bbb-8ccc-000000000001'
const P2 = '0ff9d810-aaaa-4bbb-8ccc-000000000002'
const GONE = '7a1d0c55-dddd-4eee-8fff-000000000009'

const NONE: ArchiveCounts = { projects: {}, universal: 0 }

function repo(over: Partial<RepoGroup> = {}): RepoGroup {
  return { root: ROOT, name: 'mnemo-desktop', parents: [], missions: [], children: [], ...over }
}
const snap = (...repos: RepoGroup[]): Snapshot => ({ repos, errors: [], at: new Date(NOW).toISOString() })
const pr = (over: Partial<Pr> = {}): Pr => ({ number: 7, url: 'https://github.com/x/mnemo-desktop/pull/7', state: 'OPEN', head: 'fix/issue-7', ci: 'pending', ...over })
const kid = (over: Partial<ChildSession> & { id: string }) => child({ cwd: `${ROOT}-wt-${over.id}`, updated_at: ago(MIN), parent_session: P1, ...over })
const boss = (over: Partial<ParentSession> = {}) => parent({ session_id: P1, cwd: ROOT, status: 'busy', ...over })

const robots = (w: World): Robot[] => w.territories.flatMap((t) => t.nexuses.flatMap((n) => n.robots))
const robot = (c: ChildSession, p: Pr | null = c.pr ?? null) => robotOf(c, p, null, NOW)!

describe('buildWorld: territories', () => {
  it('draws one territory per repo, with its archive, and the universal core', () => {
    const other = repo({ root: '/Users/me/github/mnemo', name: 'mnemo', parents: [boss({ session_id: P2, cwd: '/Users/me/github/mnemo' })] })
    const w = buildWorld(snap(repo({ parents: [boss()] }), other), { projects: { 'mnemo-desktop': 70, mnemo: 400 }, universal: 2400 }, NOW)
    expect(w.territories.map((t) => [t.root, t.name])).toEqual([
      [ROOT, 'mnemo-desktop'],
      ['/Users/me/github/mnemo', 'mnemo'],
    ])
    expect(w.territories.map((t) => t.archive)).toEqual([
      { project: 'mnemo-desktop', pages: 70, tier: 1 },
      { project: 'mnemo', pages: 400, tier: 2 },
    ])
    expect(w.universal).toEqual({ pages: 2400, tier: 2 })
    expect(w.at).toBe(NOW)
  })

  it('gives a project the vault does not count an empty archive', () => {
    const w = buildWorld(snap(repo({ parents: [boss()] })), NONE, NOW)
    expect(w.territories[0].archive).toEqual({ project: 'mnemo-desktop', pages: 0, tier: 0 })
  })

  it('folds a <repo>-wt-* group into its repo, whether or not the repo has a group of its own', () => {
    const wt = repo({ root: `${ROOT}-wt-c-world`, name: 'mnemo-desktop-wt-c-world', parents: [boss({ session_id: P2, cwd: `${ROOT}-wt-c-world` })] })
    const both = buildWorld(snap(repo({ parents: [boss()] }), wt), NONE, NOW)
    expect(both.territories).toHaveLength(1)
    expect(both.territories[0].nexuses.map((n) => n.sessionId)).toEqual([P1, P2])

    const alone = buildWorld(snap(wt), { projects: { 'mnemo-desktop': 9 }, universal: 0 }, NOW)
    expect(alone.territories.map((t) => [t.root, t.name, t.archive.pages])).toEqual([[ROOT, 'mnemo-desktop', 9]])
  })

  it('compares Windows roots as paths when folding', () => {
    const main = repo({ root: 'C:/Users/me/repo', name: 'repo', parents: [boss({ cwd: 'C:/Users/me/repo' })] })
    const wt = repo({ root: 'c:\\Users\\me\\repo-wt-12', name: 'repo-wt-12', parents: [boss({ session_id: P2, cwd: 'c:\\Users\\me\\repo-wt-12' })] })
    const w = buildWorld(snap(main, wt), NONE, NOW)
    expect(w.territories.map((t) => t.root)).toEqual(['C:/Users/me/repo'])
    expect(w.territories[0].nexuses).toHaveLength(2)
  })

  it('leaves out a repo with nobody left in it', () => {
    const stale = repo({ root: '/Users/me/github/mnemo', name: 'mnemo', children: [kid({ id: 'old1', live: false, state: 'done', updated_at: ago(7 * HOUR), parent_session: null })] })
    const w = buildWorld(snap(repo({ parents: [boss()] }), stale), NONE, NOW)
    expect(w.territories.map((t) => t.name)).toEqual(['mnemo-desktop'])
  })
})

describe('buildWorld: nexuses', () => {
  it('draws every live parent, with or without children, its pose and halo from its status', () => {
    const w = buildWorld(
      snap(repo({ parents: [boss({ status: 'busy' }), boss({ session_id: P2, status: 'waiting', waiting_for: 'permission prompt' }), boss({ session_id: GONE, status: 'idle', name: 'triage' })] })),
      NONE,
      NOW,
    )
    const ns = w.territories[0].nexuses
    expect(ns.map((n) => [n.pose, n.halo, n.label])).toEqual([
      ['busy', 'working', '0ff9d810'],
      ['waiting', 'needs-you', '0ff9d810'],
      ['idle', 'idle', 'triage'],
    ])
    expect(ns[0].parent?.session_id).toBe(P1)
    expect(ns[0].cwd).toBe(ROOT)
  })

  it('puts each child in its parent ring', () => {
    const w = buildWorld(snap(repo({ parents: [boss(), boss({ session_id: P2 })], children: [kid({ id: 'b2' }), kid({ id: 'a1' }), kid({ id: 'c3', parent_session: P2 })] })), NONE, NOW)
    const [n1, n2] = w.territories[0].nexuses
    expect(n1.robots.map((r) => r.id)).toEqual(['a1', 'b2'])
    expect(n2.robots.map((r) => r.id)).toEqual(['c3'])
  })

  it('draws a parent no longer alive whose children are as a dead nexus with no parent row', () => {
    const w = buildWorld(snap(repo({ children: [kid({ id: 'a1', parent_session: GONE }), kid({ id: 'b2', parent_session: GONE })] })), NONE, NOW)
    expect(w.territories[0].nexuses).toEqual([
      expect.objectContaining({ sessionId: GONE, pose: 'dead', halo: null, parent: null, label: '7a1d0c55', cwd: ROOT }),
    ])
    expect(w.territories[0].nexuses[0].robots.map((r) => r.id)).toEqual(['a1', 'b2'])
  })

  it('draws one dead nexus per dead parent, in the territory of its first child', () => {
    const other = repo({ root: '/Users/me/github/mnemo', name: 'mnemo', children: [kid({ id: 'z9', cwd: '/Users/me/github/mnemo-wt-9', parent_session: GONE })] })
    const w = buildWorld(snap(repo({ children: [kid({ id: 'a1', parent_session: GONE })] }), other), NONE, NOW)
    expect(w.territories.map((t) => t.name)).toEqual(['mnemo-desktop'])
    expect(w.territories[0].nexuses.map((n) => n.robots.map((r) => r.id))).toEqual([['a1', 'z9']])
  })

  it('never drops a child whose parent is unknown: its repo gets a dead nexus for it', () => {
    const w = buildWorld(snap(repo({ parents: [boss()], children: [kid({ id: 'a1', parent_session: null }), kid({ id: 'b2', parent_session: undefined })] })), NONE, NOW)
    const [live, unknown] = w.territories[0].nexuses
    expect(live.robots).toEqual([])
    expect(unknown).toMatchObject({ sessionId: UNKNOWN_PARENT, pose: 'dead', parent: null })
    expect(unknown.robots.map((r) => r.id)).toEqual(['a1', 'b2'])
  })

  it('draws no dead nexus once its children have left', () => {
    const w = buildWorld(snap(repo({ parents: [boss()], children: [kid({ id: 'a1', parent_session: GONE, live: false, state: 'done', updated_at: ago(7 * HOUR) })] })), NONE, NOW)
    expect(w.territories[0].nexuses.map((n) => n.sessionId)).toEqual([P1])
  })

  it('places a piece child with its piece PR and its piece as label', () => {
    const piece = { name: 'world', branch: 'feat/nexus/world', child: kid({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: 'feat/nexus/world' }), pr: pr({ ci: 'pass' }) }
    const w = buildWorld(snap(repo({ parents: [boss()], missions: [{ feature: 'nexus', contract_path: '', landable: false, pieces: [piece] }] })), NONE, NOW)
    const [r] = robots(w)
    expect(r).toMatchObject({ id: 'a1', label: 'world', badge: 'flag-ready', halo: 'done' })
  })
})

describe('buildWorld: purity', () => {
  it('gives the same world for the same inputs, and leaves them untouched', () => {
    const s = snap(repo({ parents: [boss()], children: [kid({ id: 'b2' }), kid({ id: 'a1', parent_session: GONE }), kid({ id: 'c3', parent_session: null })] }))
    const before = structuredClone(s)
    expect(buildWorld(s, NONE, NOW)).toEqual(buildWorld(s, NONE, NOW))
    expect(s).toEqual(before)
  })
})

describe('robots: identity', () => {
  it('takes the class from the model', () => {
    expect(['opus[1m]', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5-1', null, undefined].map(classOf)).toEqual(['mech', 'droid', 'drone', 'unknown', 'unknown', 'unknown'])
  })

  it('takes the level from the effort; the default has none', () => {
    expect([null, undefined, 'low', 'medium', 'high', 'xhigh', 'max', 'turbo'].map(levelOf)).toEqual([0, 0, 1, 2, 3, 4, 4, 0])
  })

  it('seeds the accessory from the id: the same each time, always in range, and varied', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `job${i.toString(16)}`)
    const got = ids.map(accessoryOf)
    expect(ids.map(accessoryOf)).toEqual(got)
    expect(got.every((a) => Number.isInteger(a) && a >= 0 && a < ACCESSORIES)).toBe(true)
    expect(new Set(got).size).toBe(ACCESSORIES)
  })

  it('labels by issue from the worktree, else the contract piece, else the short id', () => {
    expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-643`, branch: null }, null)).toBe('#643')
    expect(labelOf({ id: 'a1', cwd: '/Users/me/github/mnemo-wt-655-49bb67', branch: 'fix/x' }, null)).toBe('#655')
    expect(labelOf({ id: 'a1', cwd: 'C:\\Users\\me\\repo-wt-12\\', branch: null }, null)).toBe('#12')
    expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: 'feat/nexus/world' }, 'world')).toBe('world')
    expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: 'feat/nexus/world' }, null)).toBe('world')
    expect(labelOf({ id: 'a1', cwd: `${ROOT}-wt-c-world`, branch: null }, null)).toBe('a1')
    expect(labelOf({ id: 'a1', cwd: '', branch: null }, null)).toBe('a1')
  })

  it('names the tool from a Running detail', () => {
    expect(toolOf('Running git status')).toBe('Bash')
    expect(toolOf('writing the tests')).toBeNull()
    expect(toolOf('Running')).toBeNull()
    expect(robot(kid({ id: 'a1', detail: 'Running pnpm test' })).tool).toBe('Bash')
    // Only a working body swings a tool.
    expect(robot(kid({ id: 'a1', detail: 'Running pnpm test', tempo: 'blocked' })).tool).toBeNull()
  })

  it('carries the snapshot row and the session id', () => {
    const c = kid({ id: 'a1', session_id: 'feedc0de-0000' })
    expect(robot(c)).toMatchObject({ sessionId: 'feedc0de-0000', child: c })
  })
})

describe('robots: Q18 states', () => {
  const look = (c: ChildSession, p: Pr | null = null) => {
    const r = robot(c, p)
    return [r.pose, r.halo, r.badge, r.exit]
  }

  it('works while busy', () => {
    expect(look(kid({ id: 'a1', state: 'working', tempo: 'active' }))).toEqual(['working', 'working', null, null])
  })

  it('idles live with no ask', () => {
    expect(look(kid({ id: 'a1', state: 'idle', tempo: 'idle' }))).toEqual(['idle', 'idle', null, null])
  })

  it.each([
    ['a permission', { tempo: 'blocked', needs: 'approve Bash: rm -rf build' }],
    ['an answer', { tempo: 'blocked', needs: 'may I add a crate?' }],
    ['a sandbox', { waiting_for: 'sandbox request' }],
    ['a dialog', { waiting_for: 'dialog open' }],
  ])('needs you while waiting on %s', (_, over) => {
    expect(look(kid({ id: 'a1', ...over }))).toEqual(['waiting', 'needs-you', 'alert', null])
  })

  it('does not ask for a blocked child whose process is gone', () => {
    expect(look(kid({ id: 'a1', tempo: 'blocked', needs: 'may I?', live: false, state: 'stopped' }))).toEqual(['idle', 'idle', null, null])
  })

  it('sleeps through a rate limit, without the needs-you halo', () => {
    expect(look(kid({ id: 'a1', tempo: 'blocked', needs: 'rate limited — wait and retry' }))).toEqual(['sleeping', 'idle', 'zzz', null])
    expect(look(kid({ id: 'a1', tempo: 'blocked', live: false, detail: "You've hit your session limit · resets 3pm" }))).toEqual(['sleeping', 'idle', 'zzz', null])
  })

  it('tells a rate limit from a spent plan', () => {
    expect(isRateLimited({ needs: 'rate limited — wait and retry', detail: '' })).toBe(true)
    expect(isRateLimited({ needs: null, detail: "You've hit your limit" })).toBe(true)
    expect(isRateLimited({ needs: 'usage limit reached — check plan', detail: '' })).toBe(false)
    expect(isRateLimited({ needs: 'may I?', detail: 'Running grep rate' })).toBe(false)
  })

  it('flags an open PR whose checks run, and one with no checks yet', () => {
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'pending' }))).toEqual(['idle', 'idle', 'flag-pending', null])
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'none' }))[2]).toBe('flag-pending')
  })

  it('flags a ready PR with the done halo; a draft is not ready', () => {
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'pass' }))).toEqual(['idle', 'done', 'flag-ready', null])
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'pass', draft: true }))).toEqual(['idle', 'idle', 'flag-draft', null])
  })

  it('a draft whose checks still run is a draft, not checks running', () => {
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'pending', draft: true }))).toEqual(['idle', 'idle', 'flag-draft', null])
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'none', draft: true }))[2]).toBe('flag-draft')
  })

  it('a draft with failing checks burns', () => {
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'fail', draft: true }))).toEqual(['idle', 'idle', 'fire', null])
  })

  it.each([
    ['pending', false, 'flag-pending'],
    ['none', false, 'flag-pending'],
    ['pass', false, 'flag-ready'],
    ['fail', false, 'fire'],
    ['pending', true, 'flag-draft'],
    ['none', true, 'flag-draft'],
    ['pass', true, 'flag-draft'],
    ['fail', true, 'fire'],
  ] as const)('an open PR with checks %s, draft %s, is %s', (ci, draft, badge) => {
    expect(prBadge({ ci, draft })).toBe(badge)
    expect(robot(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci, draft })).badge).toBe(badge)
  })

  it('an ask or a rate limit outranks any PR badge', () => {
    expect(look(kid({ id: 'a1', tempo: 'blocked', needs: 'may I?' }), pr({ ci: 'pending', draft: true }))[2]).toBe('alert')
    expect(look(kid({ id: 'a1', tempo: 'blocked', needs: 'rate limited — wait and retry' }), pr({ ci: 'pending' }))[2]).toBe('zzz')
  })

  it('burns on failing checks without the needs-you halo, while pr-follow wakes the child', () => {
    expect(look(kid({ id: 'a1', live: false, state: 'done' }), pr({ ci: 'fail' }))).toEqual(['idle', 'idle', 'fire', null])
    expect(look(kid({ id: 'a1' }), pr({ ci: 'fail' }))).toEqual(['working', 'working', 'fire', null])
  })

  it('asks over a red PR once the woken child itself asks', () => {
    expect(look(kid({ id: 'a1', tempo: 'blocked', needs: 'approve Bash: git push' }), pr({ ci: 'fail' }))).toEqual(['waiting', 'needs-you', 'alert', null])
  })

  it('reads the PR off the child row when the world builds it', () => {
    const w = buildWorld(snap(repo({ parents: [boss()], children: [kid({ id: 'a1', live: false, state: 'done', pr: pr({ ci: 'fail' }) })] })), NONE, NOW)
    expect(robots(w)[0].badge).toBe('fire')
  })
})

describe('robots: Q12 exits and leaving', () => {
  const stopped = (over: Partial<ChildSession> = {}) => kid({ id: 'a1', live: false, state: 'done', ...over })

  it('celebrates a merged PR, then leaves once the exit has played', () => {
    const merged = pr({ state: 'MERGED', ci: 'pass' })
    expect(robot(stopped(), merged)).toMatchObject({ exit: 'merged', halo: 'done', badge: null })
    expect(robotOf(stopped({ updated_at: ago(EXIT_MS - 1) }), merged, null, NOW)).not.toBeNull()
    expect(robotOf(stopped({ updated_at: ago(EXIT_MS) }), merged, null, NOW)).toBeNull()
    expect(robotOf(stopped({ updated_at: null }), merged, null, NOW)).toBeNull()
  })

  it('keeps a robot whose PR is open, ready, red or a draft, however long ago it stopped', () => {
    for (const p of [pr({ ci: 'pass' }), pr({ ci: 'fail' }), pr({ draft: true }), pr()]) {
      expect(robotOf(stopped({ updated_at: ago(3 * 24 * HOUR), notice: 'delivered' }), p, null, NOW)).toMatchObject({ exit: null })
    }
  })

  it('powers down a stop without a PR only once its parent has the notice', () => {
    expect(robot(stopped({ notice: 'delivered' }))).toMatchObject({ exit: 'powered-down', halo: null })
    expect(robot(stopped({ notice: 'held' })).exit).toBeNull()
    expect(robot(stopped({ notice: null })).exit).toBeNull()
    // Absent until the notice piece lands: unknown, never delivered.
    expect(robot(stopped()).exit).toBeNull()
    expect(robotOf(stopped({ notice: 'delivered', updated_at: ago(EXIT_MS) }), null, null, NOW)).toBeNull()
  })

  it('treats a closed PR as no PR', () => {
    expect(robot(stopped({ notice: 'delivered' }), pr({ state: 'CLOSED' }))).toMatchObject({ exit: 'powered-down', badge: null })
  })

  it('does not power down a child that still runs', () => {
    expect(robot(kid({ id: 'a1', notice: 'delivered' })).exit).toBeNull()
  })

  it('keeps a stopped child with no exit for a few hours, then lets it go as history', () => {
    expect(robotOf(stopped({ updated_at: ago(5 * HOUR) }), null, null, NOW)).not.toBeNull()
    expect(robotOf(stopped({ updated_at: ago(7 * HOUR) }), null, null, NOW)).toBeNull()
    expect(robotOf(kid({ id: 'a1', updated_at: ago(7 * HOUR) }), null, null, NOW)).not.toBeNull()
  })

  it('drops a robot from the world once its exit has played', () => {
    const merged = pr({ state: 'MERGED' })
    const w = (at: number) => robots(buildWorld(snap(repo({ parents: [boss()], children: [stopped({ pr: merged })] })), NONE, at))
    expect(w(NOW).map((r) => r.exit)).toEqual(['merged'])
    expect(w(NOW + EXIT_MS)).toEqual([])
  })
})

describe('archives', () => {
  it('steps tiers at the calibrated page counts', () => {
    expect([0, TIER_GROWN - 1, TIER_GROWN, TIER_FULL - 1, TIER_FULL].map(tierOf)).toEqual([0, 0, 1, 1, 2])
  })
})

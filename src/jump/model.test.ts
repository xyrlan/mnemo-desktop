import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import { formatAge } from './age'
import { jumpEntries, worktreeState } from './model'
import { fuzzyMatch, matchWorktree, merge } from './search'

const agent = (state: AgentNode['state'], since: number): AgentNode => ({ sessionId: `s${since}`, paneId: null, state, waitingFor: null, title: 't', since })
const tree = (name: string, over: Partial<WorktreeNode> = {}): WorktreeNode => ({
  path: `/code/${name}`,
  name,
  branch: `feat/${name}`,
  kind: 'workspace',
  agents: [],
  pr: null,
  unread: false,
  ...over,
})

describe('fuzzyMatch', () => {
  it('finds a substring, case-insensitively, as one range', () => {
    expect(fuzzyMatch('Jump-Palette', 'pal')).toEqual({ score: expect.any(Number), ranges: [{ start: 5, end: 8 }] })
  })
  it('ranks a prefix above a word start above a mid-word substring', () => {
    const prefix = fuzzyMatch('palette', 'pal')!.score
    const word = fuzzyMatch('jump-palette', 'pal')!.score
    const mid = fuzzyMatch('xpalette', 'pal')!.score
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(mid)
  })
  it('ranks an exact match above a longer prefix match', () => {
    expect(fuzzyMatch('main', 'main')!.score).toBeGreaterThan(fuzzyMatch('mainline', 'main')!.score)
  })
  it('falls back to the characters in order, one range per adjacent run', () => {
    expect(fuzzyMatch('orca-redesign', 'ored')!.ranges).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ])
  })
  it('does not match characters out of order or missing', () => {
    expect(fuzzyMatch('abc', 'cb')).toBeNull()
    expect(fuzzyMatch('abc', 'abz')).toBeNull()
  })
  it('scores every substring above every scattered match', () => {
    expect(fuzzyMatch('a-very-long-worktree-name-with-the-word-at-the-endabc', 'abc')!.score).toBeGreaterThan(fuzzyMatch('abc', 'ac')!.score)
  })
})

describe('matchWorktree', () => {
  const fields = { name: 'jump-palette', branch: 'feat/orca-redesign-b/jump-palette', repo: 'mnemo-desktop' }
  it('needs every word to match some field', () => {
    expect(matchWorktree(fields, 'jump mnemo')).not.toBeNull()
    expect(matchWorktree(fields, 'jump zzz')).toBeNull()
  })
  it('highlights each word in the field it matched best', () => {
    const m = matchWorktree(fields, 'jump desk')!
    expect(m.ranges.name).toEqual([{ start: 0, end: 4 }])
    expect(m.ranges.repo).toEqual([{ start: 6, end: 10 }])
    expect(m.ranges.branch).toEqual([])
  })
  it('prefers the name to the branch for the same text', () => {
    expect(matchWorktree(fields, 'palette')!.ranges.name).toEqual([{ start: 5, end: 12 }])
  })
  it('matches everything, highlighting nothing, for an empty query', () => {
    expect(matchWorktree(fields, '  ')).toEqual({ score: 0, ranges: { name: [], branch: [], repo: [] } })
  })
})

describe('merge', () => {
  it('sorts and joins overlapping or touching ranges', () => {
    expect(merge([{ start: 5, end: 7 }, { start: 0, end: 2 }, { start: 2, end: 3 }, { start: 6, end: 9 }])).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 9 },
    ])
  })
})

describe('worktreeState', () => {
  it('is the most pressing state among its agents, null with none', () => {
    expect(worktreeState(tree('a'))).toBeNull()
    expect(worktreeState(tree('a', { agents: [agent('idle', 1), agent('done', 2), agent('working', 3)] }))).toBe('working')
    expect(worktreeState(tree('a', { agents: [agent('working', 1), agent('needs-you', 2)] }))).toBe('needs-you')
    expect(worktreeState(tree('a', { agents: [agent('idle', 1), agent('done', 2)] }))).toBe('done')
  })
})

describe('jumpEntries', () => {
  const repos: RepoNode[] = [
    { root: '/code/app', name: 'app', worktrees: [tree('app', { kind: 'main', branch: 'main' }), tree('fix-login', { agents: [agent('done', 100)] })] },
    { root: '/code/site', name: 'site', worktrees: [tree('site', { kind: 'main', branch: null }), tree('blog', { agents: [agent('working', 500), agent('idle', 50)], unread: true })] },
  ]

  it('lists every worktree with no query: recent agent activity first, then the fleet order', () => {
    expect(jumpEntries(repos, '').map((e) => e.name)).toEqual(['blog', 'fix-login', 'app', 'site'])
  })
  it('carries what a row shows', () => {
    const blog = jumpEntries(repos, '').find((e) => e.name === 'blog')!
    expect(blog).toMatchObject({ path: '/code/blog', repo: 'site', branch: 'feat/blog', kind: 'workspace', state: 'working', lastActiveAt: 500, unread: true })
    expect(jumpEntries(repos, '').find((e) => e.name === 'site')).toMatchObject({ branch: '', state: null, lastActiveAt: null })
  })
  it('keeps only what the query finds, best match first', () => {
    expect(jumpEntries(repos, 'site').map((e) => e.name)).toEqual(['site', 'blog'])
    expect(jumpEntries(repos, 'login').map((e) => e.name)).toEqual(['fix-login'])
    expect(jumpEntries(repos, 'nothing-here')).toEqual([])
  })
  it('breaks a score tie by recent activity', () => {
    expect(jumpEntries(repos, 'feat').map((e) => e.name)).toEqual(['blog', 'fix-login'])
  })
})

describe('formatAge', () => {
  const now = 1_000_000_000
  it('is compact and numeric in every bucket', () => {
    expect(formatAge(null, now)).toBeUndefined()
    expect(formatAge(now - 5_000, now)).toBe('<1m')
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m')
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatAge(now - 47 * 3_600_000, now)).toBe('47h')
    expect(formatAge(now - 50 * 3_600_000, now)).toBe('2d')
  })
})

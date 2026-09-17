import { childSession, cloneDest, firstRows, githubError, isFolded, otherErrors, paneForSession, relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession, type Pr } from './types'

const sess = (o: Partial<HomeSession> & { id: string }): HomeSession =>
  ({ title: 't', cwd: '/r', last_at: 0, transcript: true, live: null, kind: 'interactive', agent: null, ...o })
const repo = (o: Partial<HomeRepo> & { root: string }): HomeRepo =>
  ({ name: o.root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, unresolved: false, sessions: [], children: [], ...o })

test('visibleRepos drops hidden unless showHidden, filters by name/path', () => {
  const rs = [repo({ root: '/a/mnemo' }), repo({ root: '/a/secret', hidden: true }), repo({ root: '/b/desk' })]
  expect(visibleRepos(rs, '', false, false).map((r) => r.name)).toEqual(['mnemo', 'desk'])
  expect(visibleRepos(rs, '', true, false).map((r) => r.name)).toEqual(['mnemo', 'secret', 'desk'])
  expect(visibleRepos(rs, '/b', false, false).map((r) => r.name)).toEqual(['desk'])
  expect(visibleRepos(rs, 'MNE', false, false).map((r) => r.name)).toEqual(['mnemo'])
})

test('visibleRepos folds unresolved protected folders unless shown, matched by a filter, or pinned', () => {
  const rs = [
    repo({ root: '/gh/mnemo' }),
    repo({ root: '/Users/me/Downloads/public', unresolved: true }),
    repo({ root: '/Users/me/Desktop/kept', unresolved: true, pinned: true }),
  ]
  expect(rs.map(isFolded)).toEqual([false, true, false])
  expect(visibleRepos(rs, '', false, false).map((r) => r.name)).toEqual(['mnemo', 'kept'])
  expect(visibleRepos(rs, '', false, true).map((r) => r.name)).toEqual(['mnemo', 'public', 'kept'])
  expect(visibleRepos(rs, 'downloads', false, false).map((r) => r.name)).toEqual(['public'])
  expect(visibleRepos(rs, 'mnemo', false, true).map((r) => r.name)).toEqual(['mnemo'])
  // A hidden one stays behind "escondidos" even when a filter matches it.
  expect(visibleRepos([repo({ root: '/dl/h', unresolved: true, hidden: true })], 'h', false, false)).toEqual([])
})

test('whatClickDoes covers the five states', () => {
  const panes = { 7: { id: 7, view: 'terminal', sessionId: 'x' } }
  expect(whatClickDoes(sess({ id: 'x', live: 'here' }), panes)).toEqual({ kind: 'focus', pane: 7 })
  expect(whatClickDoes(sess({ id: 'y', live: 'here' }), panes)).toEqual({ kind: 'nothing', why: 'open in another terminal' })
  expect(whatClickDoes(sess({ id: 'b', live: 'bg' }), panes)).toEqual({ kind: 'command', cmd: 'claude attach b', sessionId: 'b' })
  expect(whatClickDoes(sess({ id: 'e', live: 'elsewhere' }), panes)).toEqual({ kind: 'nothing', why: 'open in another terminal' })
  expect(whatClickDoes(sess({ id: 'd' }), panes)).toEqual({ kind: 'command', cmd: 'claude --resume d', sessionId: 'd' })
  expect(whatClickDoes(sess({ id: 'g', transcript: false }), panes)).toEqual({ kind: 'nothing', why: 'transcript not found' })
})

test('paneForSession finds the pane running a session', () => {
  expect(paneForSession({ 3: { id: 3 }, 9: { id: 9, sessionId: 's' } }, 's')).toBe(9)
  expect(paneForSession({}, 's')).toBeNull()
})

test('cloneDest derives the folder name from owner/repo, URL, or .git URL', () => {
  expect(cloneDest('/gh', 'xyrlan/mnemo')).toBe('/gh/mnemo')
  expect(cloneDest('/gh/', 'https://github.com/xyrlan/mnemo-desktop')).toBe('/gh/mnemo-desktop')
  expect(cloneDest('/gh', 'git@github.com:xyrlan/mnemo.git')).toBe('/gh/mnemo')
  expect(cloneDest('/gh', '  ')).toBeNull()
})

test('relTime buckets minutes, hours, days', () => {
  const now = 10_000_000_000
  expect(relTime(0, now)).toBe('')
  expect(relTime(now - 5 * 60000, now)).toBe('5m')
  expect(relTime(now - 3 * 3600000, now)).toBe('3h')
  expect(relTime(now - 5 * 86400000, now)).toBe('5d')
})

test('a repo carries its open issues and PRs as home_snapshot sends them', () => {
  // Shape of `HomeRepo` from `home_snapshot` (see home::tests::github_lists_join_from_the_cache…).
  const wire = JSON.parse(`{"root":"/gh/a","name":"a","last_at":0,"pinned":false,"hidden":false,"unresolved":false,
    "sessions":[],"children":[],"issues":[],
    "prs":[{"number":7,"title":"t","state":"open","checks":"none","child":null,"url":"u"},
           {"number":8,"title":"d","state":"draft","checks":"pending","child":"4480e61c","url":"v"}]}`) as HomeRepo
  const prs: Pr[] = wire.prs ?? []
  expect(prs.map((p) => [p.number, p.child])).toEqual([[7, null], [8, '4480e61c']])
  expect(repo({ root: '/gh/b' }).prs).toBeUndefined()
})

test('refreshGithub invokes the lens refresh command', async () => {
  vi.resetModules()
  const invoke = vi.fn().mockResolvedValue(undefined)
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
  vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
  const { refreshGithub } = await import('./client')
  await expect(refreshGithub()).resolves.toBeUndefined()
  expect(invoke).toHaveBeenCalledWith('home_refresh_github')
  vi.doUnmock('@tauri-apps/api/core')
  vi.doUnmock('@tauri-apps/plugin-dialog')
})

test('githubError finds a repo in the lens lines by name; otherErrors keeps the rest', () => {
  const errors = ['github (other, desk): no git remotes found', 'github (mnemo): gh: auth required', 'history unreadable']
  expect(githubError(errors, 'desk')).toBe('no git remotes found')
  expect(githubError(errors, 'mnemo')).toBe('gh: auth required')
  expect(githubError(errors, 'des')).toBeNull()
  expect(githubError(errors, 'history')).toBeNull()
  expect(otherErrors(errors)).toEqual(['history unreadable'])
})

test('childSession matches a job short id to the child session it prefixes', () => {
  const r = repo({ root: '/gh/a', children: [sess({ id: 'aaaa1111-2222' }), sess({ id: 'bbbb2222-3333' })] })
  expect(childSession(r, 'bbbb2222')?.id).toBe('bbbb2222-3333')
  expect(childSession(r, 'cccc3333')).toBeNull()
})

test('firstRows keeps every live session and the most recent quiet ones, in order', () => {
  const ss = [sess({ id: 'a' }), sess({ id: 'b', live: 'bg' }), sess({ id: 'c' }), sess({ id: 'd' }), sess({ id: 'e', live: 'here' })]
  expect(firstRows(ss, 2)).toEqual({ rows: [ss[0], ss[1], ss[2], ss[4]], rest: 1 })
  expect(firstRows(ss, 0).rows.map((s) => s.id)).toEqual(['b', 'e'])
  expect(firstRows([], 3)).toEqual({ rows: [], rest: 0 })
})

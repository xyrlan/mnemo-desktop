import { cloneDest, paneForSession, relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession } from './types'

const sess = (o: Partial<HomeSession> & { id: string }): HomeSession =>
  ({ title: 't', cwd: '/r', last_at: 0, transcript: true, live: null, kind: 'interactive', ...o })
const repo = (o: Partial<HomeRepo> & { root: string }): HomeRepo =>
  ({ name: o.root.split('/').pop()!, last_at: 0, pinned: false, hidden: false, sessions: [], ...o })

test('visibleRepos drops hidden unless showHidden, filters by name/path', () => {
  const rs = [repo({ root: '/a/mnemo' }), repo({ root: '/a/secret', hidden: true }), repo({ root: '/b/desk' })]
  expect(visibleRepos(rs, '', false).map((r) => r.name)).toEqual(['mnemo', 'desk'])
  expect(visibleRepos(rs, '', true).map((r) => r.name)).toEqual(['mnemo', 'secret', 'desk'])
  expect(visibleRepos(rs, '/b', false).map((r) => r.name)).toEqual(['desk'])
  expect(visibleRepos(rs, 'MNE', false).map((r) => r.name)).toEqual(['mnemo'])
})

test('whatClickDoes covers the five states', () => {
  const panes = { 7: { id: 7, view: 'terminal', sessionId: 'x' } }
  expect(whatClickDoes(sess({ id: 'x', live: 'here' }), panes)).toEqual({ kind: 'focus', pane: 7 })
  expect(whatClickDoes(sess({ id: 'y', live: 'here' }), panes)).toEqual({ kind: 'nothing', why: 'aberta em outro terminal' })
  expect(whatClickDoes(sess({ id: 'b', live: 'bg' }), panes)).toEqual({ kind: 'command', cmd: 'claude attach b', sessionId: 'b' })
  expect(whatClickDoes(sess({ id: 'e', live: 'elsewhere' }), panes)).toEqual({ kind: 'nothing', why: 'aberta em outro terminal' })
  expect(whatClickDoes(sess({ id: 'd' }), panes)).toEqual({ kind: 'command', cmd: 'claude --resume d', sessionId: 'd' })
  expect(whatClickDoes(sess({ id: 'g', transcript: false }), panes)).toEqual({ kind: 'nothing', why: 'transcript não encontrado' })
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

import { childLabel, needsYou, pruneGone } from './needs'
import { child, desktop, snapshot } from '../mission/fixtures'
import { merged, withPrs } from './fixtures'
import type { Snapshot } from '../mission/types'

test('blocked children, then red CI, then landable contracts', () => {
  expect(needsYou(withPrs).map((n) => n.key)).toEqual([
    'blocked:094c6a03',
    'ci:/Users/me/github/mnemo#13',
    'land:/Users/me/github/mnemo/docs/contracts/round4.md',
  ])
  const [b] = needsYou(snapshot)
  expect(b).toMatchObject({ kind: 'blocked', label: 'vault', repo: { name: 'mnemo-desktop' }, mission: { feature: 'round3' } })
})

test('a green open PR of a contract that cannot land yet is ready to merge, after red CI', () => {
  const m = desktop.missions[0]
  const pr = (n: number, ci: 'pass' | 'fail' | 'pending', state = 'OPEN') => ({ number: n, url: `u${n}`, state, head: `h${n}`, ci })
  const repo = {
    ...desktop,
    missions: [{ ...m, pieces: [{ ...m.pieces[0], pr: pr(1, 'pass') }, { ...m.pieces[1], pr: pr(2, 'fail') }, { name: 'x', branch: 'b', child: null, pr: pr(3, 'pass', 'MERGED') }, { name: 'y', branch: 'b', child: null, pr: pr(4, 'pending') }] }],
  }
  const needs = needsYou({ ...snapshot, repos: [repo] })
  expect(needs.map((n) => n.key)).toEqual(['blocked:094c6a03', `ci:${desktop.root}#2`, `ready:${desktop.root}#1`])
  expect(needs[2]).toMatchObject({ kind: 'ready', piece: 'cockpit', pr: { number: 1 } })
})

test('a merged or closed PR never needs you, even with a red last rollup', () => {
  expect(needsYou({ ...snapshot, repos: [merged] })).toEqual([])
  const [m] = merged.missions
  // Beside an open red PR, only the open one is a row.
  const open = { ...m.pieces[0], name: 'api', pr: { ...m.pieces[0].pr!, number: 30, state: 'OPEN' } }
  const repo = { ...merged, missions: [{ ...m, pieces: [...m.pieces, open] }] }
  expect(needsYou({ ...snapshot, repos: [repo] }).map((n) => n.key)).toEqual([`ci:${merged.root}#30`])
})

test('nothing when nothing is blocked, red, ready or landable', () => {
  expect(needsYou({ ...snapshot, repos: snapshot.repos.slice(1) })).toEqual([])
})

test('row labels: the piece, else the issue, never the worktree folder', () => {
  const c = child({ id: 'abcd1234', cwd: '/Users/me/github/mnemo-desktop-wt-c-chrome', intent: 'build the chrome' })
  expect(childLabel(c, 'chrome')).toBe('chrome')
  expect(childLabel({ ...c, branch: 'fix/issue-40' })).toBe('#40')
  expect(childLabel({ ...c, name: 'issue-41' })).toBe('#41')
  expect(childLabel({ ...c, name: 'mnemo-desktop-wt-c-chrome' })).toBe('build the chrome')
  expect(childLabel({ ...c, name: 'tidy docs' })).toBe('tidy docs')
  expect(childLabel(c)).toBe('build the chrome')
  expect(childLabel({ ...c, intent: null })).toBe('abcd1234')
})

test('a finished child whose worktree is gone is dropped, with the repo named after that folder', () => {
  const gone = child({ id: 'dead0001', live: false, state: 'done', cwd: '/Users/me/github/mnemo-desktop-wt-c-old', branch: null })
  const kept = child({ id: 'done0002', live: false, state: 'done', cwd: '/Users/me/github/mnemo-desktop-wt-c-new', branch: 'feat/x/new' })
  const running = child({ id: 'live0003', cwd: '/tmp/scratch', branch: null })
  const snap: Snapshot = {
    ...snapshot,
    repos: [
      { root: '/Users/me/github/mnemo-desktop-wt-c-old', name: 'mnemo-desktop-wt-c-old', parents: [], missions: [], children: [gone] },
      { ...desktop, children: [kept, running] },
    ],
  }
  const out = pruneGone(snap)
  expect(out.repos.map((r) => r.name)).toEqual(['mnemo-desktop'])
  expect(out.repos[0].children.map((c) => c.id)).toEqual(['done0002', 'live0003'])
})

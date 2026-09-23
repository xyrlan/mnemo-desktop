import { childLabel, needsYou, pruneGone } from './needs'
import { child, desktop, snapshot } from '../mission/fixtures'
import * as fixtures from './fixtures'
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

test('a PR a child opened outside any contract is a row too: red CI to open, green to merge, a draft as ready', () => {
  const { issuePrs } = fixtures
  const needs = needsYou({ ...snapshot, repos: [issuePrs] })
  const root = issuePrs.root
  expect(needs.map((n) => n.key)).toEqual([`ci:${root}#50`, `ready:${root}#49`, `ready:${root}#51`, `ready:${root}#47`])
  expect(needs[0]).toMatchObject({ kind: 'ci', piece: '#40', mission: null, pr: { failing: ['test (windows-latest)'] } })
  expect(needs[1]).toMatchObject({ kind: 'ready', piece: '#41', mission: null, pr: { draft: true } })
  // Pending CI needs nobody yet, and a merged PR is history.
  expect(needs.some((n) => n.key.endsWith('#52') || n.key.endsWith('#48'))).toBe(false)
})

test('a child whose worktree is gone stays while its PR is open, so the PR keeps its row', () => {
  const out = pruneGone({ ...snapshot, repos: [fixtures.issuePrs] })
  expect(out.repos[0].children.map((c) => c.id)).toContain('i45')
  // Without an open PR, the same child is dropped.
  const closed = { ...fixtures.issuePrs, children: fixtures.issuePrs.children.map((c) => (c.id === 'i45' ? { ...c, pr: { ...c.pr!, state: 'CLOSED' } } : c)) }
  expect(pruneGone({ ...snapshot, repos: [closed] }).repos[0].children.map((c) => c.id)).not.toContain('i45')
})

test('one PR is one row, even when a contract piece and a child both carry it', () => {
  const m = desktop.missions[0]
  const shared = { number: 60, url: 'u60', state: 'OPEN', head: 'feat/round3/cockpit', ci: 'pass' as const }
  const repo = { ...desktop, missions: [{ ...m, pieces: [{ ...m.pieces[0], pr: shared }] }], children: [child({ id: 'dup', branch: 'feat/round3/cockpit', pr: shared })] }
  expect(needsYou({ ...snapshot, repos: [repo] }).filter((n) => n.kind === 'ready').map((n) => n.key)).toEqual([`ready:${desktop.root}#60`])
})

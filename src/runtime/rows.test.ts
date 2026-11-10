import { child, snapshot } from '../mission/fixtures'
import type { Pr, Snapshot } from '../mission/types'
import { childRow, missionRow, parentRow, prRow, repoRoot } from './rows'

const pr = (number: number): Pr => ({ number, url: `https://github.com/example/mnemo-desktop/pull/${number}`, state: 'OPEN', head: 'feat/x', ci: 'pass' })

test('a world session finds its child by its session id, its short id, or a short id it begins with', () => {
  const snap: Snapshot = { ...snapshot, repos: [{ ...snapshot.repos[0], children: [child({ id: 'c0ffee01', session_id: 'c0ffee01-1111-2222' }), child({ id: 'beef0002', session_id: null })] }] }
  expect(childRow(snap, { id: 'c0ffee01-1111-2222' })?.id).toBe('c0ffee01')
  expect(childRow(snap, { id: 'c0ffee01' })?.id).toBe('c0ffee01')
  expect(childRow(snap, { id: 'beef0002-9999' })?.id).toBe('beef0002')
  // a contract's piece is a child too
  expect(childRow(snap, { id: 'a43d3832' })?.branch).toBe('feat/round3/cockpit')
  expect(childRow(snap, { id: '0ff9d810-aaaa' })).toBeUndefined()
  expect(parentRow(snap, '0ff9d810-aaaa')?.name).toBe('round3 dispatch')
})

test("a piece's pull request wins over the child's own, and a number picks the one a card shows", () => {
  const piece = child({ id: 'a43d3832', pr: pr(7) })
  const snap: Snapshot = { ...snapshot, repos: [{ ...snapshot.repos[0], missions: [{ ...snapshot.repos[0].missions[0], pieces: [{ name: 'cockpit', branch: 'b', child: piece, pr: pr(9) }] }] }] }
  expect(prRow(snap, piece)?.number).toBe(9)
  expect(prRow(snap, piece, 7)?.number).toBe(7)
  expect(prRow(snap, piece, 12)).toBeNull()
  expect(prRow(snap, child({ id: 'nobody' }))).toBeNull()
})

test('a worktree beside its repo folds into it', () => {
  const known = ['/Users/me/github/mnemo-desktop', '/Users/me/github/mnemo']
  expect(repoRoot('/Users/me/github/mnemo-desktop-wt-c-cockpit', known)).toBe('/Users/me/github/mnemo-desktop')
  expect(repoRoot('/Users/me/github/mnemo-desktop/.claude/worktrees/x', known)).toBe('/Users/me/github/mnemo-desktop')
  expect(repoRoot('/Users/me/elsewhere', known)).toBe('/Users/me/elsewhere')
})

test('a mission is found by its repo and its feature', () => {
  expect(missionRow(snapshot, '/Users/me/github/mnemo-desktop', 'round3')?.contract_path).toContain('round3.md')
  expect(missionRow(snapshot, '/Users/me/github/mnemo', 'round3')).toBeUndefined()
})

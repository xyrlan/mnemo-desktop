import { childWord, needKind, permissionAsk, delta, missionSummary, isRecent, pruneSnapshot, allChildren, type Mission, type ChildSession, type Snapshot } from './types'

test('childWord folds state and tempo', () => {
  expect(childWord({ state: 'working', tempo: 'active', live: true })).toBe('active')
  expect(childWord({ state: 'working', tempo: 'blocked', live: true })).toBe('BLOCKED')
  expect(childWord({ state: 'working', tempo: 'stalled', live: true })).toBe('stalled')
  expect(childWord({ state: 'done', tempo: 'active', live: false })).toBe('done')
  expect(childWord({ state: 'stopped', tempo: 'active', live: false })).toBe('stopped')
  expect(childWord({ state: 'working', tempo: 'active', live: false })).toBe('stopped')
  expect(childWord({ state: 'working', tempo: 'blocked', live: false })).toBe('stopped')
})

test('delta counts events since the looked marker, none when never looked', () => {
  expect(delta({ id: 'a', timeline_len: 9 }, {})).toBe(0)
  expect(delta({ id: 'a', timeline_len: 9 }, { a: 6 })).toBe(3)
  expect(delta({ id: 'a', timeline_len: 4 }, { a: 6 })).toBe(0)
})

test('missionSummary counts PRs and folds CI', () => {
  const m: Mission = {
    feature: 'f', contract_path: 'c', landable: false,
    pieces: [
      { name: 'a', branch: 'x', child: null, pr: { number: 1, url: '', state: 'OPEN', head: 'x', ci: 'pass' } },
      { name: 'b', branch: 'y', child: null, pr: null },
    ],
  }
  expect(missionSummary(m)).toEqual({ withPr: 1, total: 2, ci: 'pass' })
  m.pieces[1].pr = { number: 2, url: '', state: 'OPEN', head: 'y', ci: 'pending' }
  expect(missionSummary(m).ci).toBe('pending')
  m.pieces[0].pr!.ci = 'fail'
  expect(missionSummary(m).ci).toBe('fail')
})

const child = (over: Partial<ChildSession>): ChildSession => ({
  id: 'c', session_id: null, name: null, state: 'working', tempo: 'active', needs: null, detail: '', suggested_reply: null,
  cwd: '/x', tokens: 0, live: true, updated_at: null, intent: null, branch: null, timeline_len: 0, ...over,
})

test('isRecent keeps live and recently finished children only', () => {
  const now = Date.parse('2026-09-15T12:00:00Z')
  expect(isRecent(child({ live: true, updated_at: '2020-01-01T00:00:00Z' }), now)).toBe(true)
  expect(isRecent(child({ live: false, updated_at: '2026-09-15T10:00:00Z' }), now)).toBe(true)
  expect(isRecent(child({ live: false, updated_at: '2026-09-14T10:00:00Z' }), now)).toBe(false)
  expect(isRecent(child({ live: false, updated_at: null }), now)).toBe(false)
})

test('pruneSnapshot drops stale children and empty repos', () => {
  const now = Date.parse('2026-09-15T12:00:00Z')
  const snap: Snapshot = {
    at: '', errors: [],
    repos: [
      { root: '/a', name: 'a', parents: [], missions: [], children: [child({ id: 'old', live: false, updated_at: '2026-09-01T00:00:00Z' })] },
      { root: '/b', name: 'b', parents: [], missions: [], children: [child({ id: 'live' })] },
      { root: '/c', name: 'c', parents: [{ session_id: 's', pid: 1, name: null, status: 'idle', cwd: '/c' }], missions: [], children: [] },
    ],
  }
  const out = pruneSnapshot(snap, now)
  expect(out.repos.map((r) => r.name)).toEqual(['b', 'c'])
})

test('allChildren dedupes by id across repos', () => {
  const snap: Snapshot = {
    at: '', errors: [],
    repos: [
      { root: '/a', name: 'a', parents: [], missions: [], children: [child({ id: 'x' }), child({ id: 'x' })] },
      { root: '/b', name: 'b', parents: [], missions: [], children: [child({ id: 'x' }), child({ id: 'y' })] },
    ],
  }
  expect(allChildren(snap).map((c) => c.id)).toEqual(['x', 'y'])
})

test('needKind: a permission prompt from claude agents or an approve ask from mnemo; anything else is a question', () => {
  expect(needKind({ needs: 'approve Bash: cd ~/.claude/projects && ls', waiting_for: null })).toBe('permission')
  expect(needKind({ needs: 'approve Bash: touch x', waiting_for: 'permission prompt' })).toBe('permission')
  expect(needKind({ needs: 'may I add a crate?', waiting_for: 'permission prompt' })).toBe('permission')
  expect(needKind({ needs: null, waiting_for: 'permission prompt' })).toBe('permission')
  expect(needKind({ needs: 'may I add a crate?', waiting_for: null })).toBe('question')
  expect(needKind({ needs: 'should I approve the PR?' })).toBe('question')
  expect(needKind({ needs: null })).toBe('question')
})

test('permissionAsk drops the approve prefix', () => {
  expect(permissionAsk({ needs: 'approve Bash: touch approve-probe.txt && ls -la' })).toBe('Bash: touch approve-probe.txt && ls -la')
  expect(permissionAsk({ needs: 'Edit src/x.ts' })).toBe('Edit src/x.ts')
  expect(permissionAsk({ needs: null })).toBeNull()
})

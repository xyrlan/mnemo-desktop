import { buildInbox, rowChild } from './inbox'
import { child, notes } from '../mission/fixtures'
import { withPrs } from './fixtures'
import type { Snapshot } from '../mission/types'

const NOW = Date.parse('2026-09-15T15:00:00')

test('needs, then who is working, then who finished today; labels are pieces and issues', () => {
  const snap: Snapshot = { ...withPrs, repos: withPrs.repos.map((r) => (r.name === 'mnemo' ? stamp(r) : r)) }
  const inbox = buildInbox(snap, NOW)
  expect(inbox.needs.map((n) => n.kind)).toEqual(['blocked', 'ci', 'land'])
  expect(inbox.working.map((r) => [r.label, r.repo.name, r.mission?.feature ?? null])).toEqual([
    ['cockpit', 'mnemo-desktop', 'round3'],
    ['#40', 'mnemo', null],
  ])
  expect(inbox.done.map((r) => [r.label, r.mission?.feature])).toEqual([['api', 'round4']])
  expect(rowChild(inbox.done[0])?.id).toBe('beef0001')
  expect(rowChild(inbox.needs[1])).toBeNull()
})

test('finished yesterday, stopped, or blocked children are not in the lower lists', () => {
  const repo = {
    ...notes,
    children: [
      child({ id: 'y', state: 'done', live: false, updated_at: '2026-09-14T23:00:00' }),
      child({ id: 's', state: 'stopped', live: false, updated_at: '2026-09-15T10:00:00' }),
      child({ id: 'b', tempo: 'blocked', needs: '?' }),
      child({ id: 't', tempo: 'stalled' }),
      child({ id: 'd', state: 'done', live: false, updated_at: '2026-09-15T09:00:00' }),
    ],
  }
  const inbox = buildInbox({ ...withPrs, repos: [repo] }, NOW)
  expect(inbox.needs.map((n) => n.key)).toEqual(['blocked:b'])
  expect(inbox.working.map((r) => r.child.id)).toEqual(['t'])
  expect(inbox.done.map((r) => r.child.id)).toEqual(['d'])
})

/** The fixture's finished `api` child, finished today at NOW's date. */
function stamp(r: Snapshot['repos'][number]) {
  return { ...r, missions: r.missions.map((m) => ({ ...m, pieces: m.pieces.map((p) => (p.child ? { ...p, child: { ...p.child, updated_at: '2026-09-15T11:00:00' } } : p)) })) }
}

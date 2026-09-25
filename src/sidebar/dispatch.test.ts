import type { ChildSession, Mission, Snapshot } from '../mission/types'
import { childOf, openChild, openChildSession, openWave, waveChild, type DispatchRoutes } from './dispatch'

const child = (id: string, more: Partial<ChildSession> = {}): ChildSession => ({
  id,
  session_id: `${id}-0000-full`,
  name: null,
  state: 'running',
  tempo: 'steady',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd: `/r/app-wt-${id}`,
  tokens: 0,
  live: true,
  updated_at: null,
  intent: null,
  branch: null,
  timeline_len: 0,
  ...more,
})
const mission = (feature: string, children: ChildSession[]): Mission => ({
  feature,
  contract_path: '',
  pieces: children.map((c) => ({ name: c.id, branch: `feat/${feature}/${c.id}`, child: c, pr: null })),
  landable: false,
})
const snap = (missions: Mission[], loose: ChildSession[] = []): Snapshot => ({
  repos: [{ root: '/r/app', name: 'app', parents: [], missions, children: loose }],
  errors: [],
  at: '',
})

/** The Dispatch tab as a recorder: `parents` says where each child belongs. */
function fakeRoutes(parents: Record<string, string>) {
  const opened: Array<[string, string | undefined]> = []
  const routes: DispatchRoutes = {
    openDispatch: (parent, c) => void opened.push([parent, c]),
    parentWorktree: (id) => parents[id] ?? null,
    useWaveLines: () => [],
  }
  return { routes, opened }
}

test('a child is found by its full session id, its short id, or a hook’s full id over a short one', () => {
  const known = child('aaaa1111')
  const short = child('bbbb2222', { session_id: null })
  const s = snap([mission('w', [known])], [short])
  expect(childOf(s, 'aaaa1111-0000-full')?.id).toBe('aaaa1111')
  expect(childOf(s, 'bbbb2222')?.id).toBe('bbbb2222')
  expect(childOf(s, 'bbbb2222-9999-hook')?.id).toBe('bbbb2222')
  expect(childOf(s, 'parent-session')).toBeNull()
})

test('a child opens in its parent’s tab, selected; without the tab or a parent, the caller keeps its old way', () => {
  const { routes, opened } = fakeRoutes({ aaaa1111: '/r/app' })
  expect(openChild(routes, 'aaaa1111')).toBe(true)
  expect(opened).toEqual([['/r/app', 'aaaa1111']])
  expect(openChild(routes, 'orphan')).toBe(false)
  expect(openChild(null, 'aaaa1111')).toBe(false)
  expect(opened).toHaveLength(1)
})

test('an agent click routes only when the agent is a dispatched child', () => {
  const { routes, opened } = fakeRoutes({ aaaa1111: '/r/app' })
  const s = snap([mission('w', [child('aaaa1111')])])
  expect(openChildSession(routes, s, 'interactive-1')).toBe(false)
  expect(openChildSession(null, s, 'aaaa1111-0000-full')).toBe(false)
  expect(openChildSession(routes, s, 'aaaa1111-0000-full')).toBe(true)
  expect(opened).toEqual([['/r/app', 'aaaa1111']])
})

test('a wave line opens on the child that needs you, else one still running, else any', () => {
  const done = child('d0000000', { state: 'done', live: false })
  const running = child('r0000000')
  const blocked = child('b0000000', { tempo: 'blocked', needs: 'may I add a crate?' })
  const elsewhere = child('e0000000', { tempo: 'blocked' })
  const parents = { d0000000: '/r/app', r0000000: '/r/app', b0000000: '/r/app', e0000000: '/r/app-wt-other' }
  const { routes } = fakeRoutes(parents)
  // A sibling dispatched from another workspace is not this line's.
  expect(waveChild(routes, snap([mission('w', [done, elsewhere, running, blocked])]), 'w', '/r/app')).toBe('b0000000')
  expect(waveChild(routes, snap([mission('w', [done, running])]), 'w', '/r/app')).toBe('r0000000')
  expect(waveChild(routes, snap([mission('w', [done])]), 'w', '/r/app')).toBe('d0000000')
  expect(waveChild(routes, snap([mission('w', [elsewhere])]), 'w', '/r/app')).toBeNull()
  expect(waveChild(routes, snap([mission('w', [done])]), 'other', '/r/app')).toBeNull()
})

test('a line with no child found (the tab’s Issues line) opens the tab on its feature', () => {
  const { routes, opened } = fakeRoutes({ aaaa1111: '/r/app' })
  const s = snap([mission('w', [child('aaaa1111')])], [child('loose000')])
  openWave(routes, s, 'w', '/r/app')
  openWave(routes, s, 'Issues', '/r/app')
  expect(opened).toEqual([
    ['/r/app', 'aaaa1111'],
    ['/r/app', 'Issues'],
  ])
})

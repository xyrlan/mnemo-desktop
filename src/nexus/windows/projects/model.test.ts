import type { HomeRepo, HomeSession } from '../../../home/types'
import { added, cloneBase, cloneCommand, liveSessions } from './model'

const session = (id: string, last_at: number, live: HomeSession['live'], extra: Partial<HomeSession> = {}): HomeSession => ({
  id,
  title: `title ${id}`,
  cwd: '/gh/mnemo',
  last_at,
  transcript: true,
  live,
  kind: 'interactive',
  agent: null,
  ...extra,
})
const repo = (sessions: HomeSession[], children: HomeSession[] = []): HomeRepo => ({ root: '/gh/mnemo', name: 'mnemo', last_at: 0, pinned: false, hidden: false, unresolved: false, sessions, children })

test('a repo lists its live sessions and its live children, newest first, never an ended one', () => {
  const r = repo([session('a', 1, 'here'), session('b', 5, null), session('c', 3, 'elsewhere', { agent: 'fix-tabs' })], [session('d', 2, 'bg'), session('e', 9, null)])
  expect(liveSessions(r)).toEqual([
    { id: 'c', title: 'fix-tabs', live: 'elsewhere', robot: false },
    { id: 'd', title: 'title d', live: 'bg', robot: true },
    { id: 'a', title: 'title a', live: 'here', robot: false },
  ])
})

test('a session with no title is named by its short id', () => {
  expect(liveSessions(repo([session('0199aaaa-bbbb', 1, 'here', { title: '' })]))[0].title).toBe('0199aaaa')
})

test('the clone base is the setting, else the default', () => {
  expect(cloneBase('/code', '/gh')).toBe('/code')
  expect(cloneBase(null, '/gh')).toBe('/gh')
})

test('a clone runs gh repo clone into its destination', () => {
  expect(cloneCommand(' owner/mnemo ', '/gh/mnemo')).toBe('gh repo clone owner/mnemo /gh/mnemo')
})

test('adding a repo saves it once and shows it again if it was hidden', () => {
  expect(added('/gh/mnemo', [], ['/gh/mnemo', '/gh/x'])).toEqual({ projects: ['/gh/mnemo'], hidden: ['/gh/x'] })
  expect(added('/gh/mnemo', ['/gh/mnemo'], [])).toEqual({ projects: null, hidden: null })
})

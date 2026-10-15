import { sessionTitle } from './tabs'
import type { HomeRepo, HomeSession, HomeSnapshot } from '../home/types'

const session = (id: string, title: string, agent: string | null = null): HomeSession => ({ id, title, cwd: '/r', last_at: 0, transcript: true, live: null, kind: 'interactive', agent })
const repo = (sessions: HomeSession[], children: HomeSession[] = []): HomeRepo => ({ root: '/r', name: 'r', last_at: 0, pinned: false, hidden: false, unresolved: false, sessions, children })
const home = (repos: HomeRepo[]): HomeSnapshot => ({ repos, clone_base: '', errors: [], protected: 0 })

test("a session is named by Home's title, else its claude agents name, in sessions or children", () => {
  const h = home([repo([session('a', 'fix the build'), session('b', '', 'quiet-otter')], [session('c', 'child work')])])
  expect(sessionTitle(h, 'a')).toBe('fix the build')
  expect(sessionTitle(h, 'b')).toBe('quiet-otter')
  expect(sessionTitle(h, 'c')).toBe('child work')
})

test('a session Home does not know, or knows by no name, has no title', () => {
  expect(sessionTitle(home([repo([session('a', '')])]), 'a')).toBeUndefined()
  expect(sessionTitle(home([]), 'z')).toBeUndefined()
})

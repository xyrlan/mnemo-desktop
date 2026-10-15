import type { HomeRepo } from '../home/types'
import { knownRepos } from './repos'

const home = (root: string, name: string, more: Partial<HomeRepo> = {}): HomeRepo => ({
  root,
  name,
  last_at: 0,
  pinned: false,
  hidden: false,
  unresolved: false,
  sessions: [],
  children: [],
  ...more,
})

test('every repo known once, compared as paths: the fleet’s, then PROJECTS’, then the saved projects not read yet', () => {
  const fleet = [{ root: 'C:\\Users\\you\\code\\app', name: 'app' }]
  const listed = [
    home('c:/Users/you/code/app', 'app'),
    home('/Users/you/code/notes', 'notes'),
    home('/Users/you/code/secret', 'secret', { hidden: true }),
    home('/Users/you/Downloads', 'Downloads', { unresolved: true }),
  ]
  expect(knownRepos(fleet, listed, ['/Users/you/code/notes/', '/Users/you/code/just-added', ''])).toEqual([
    { root: 'C:\\Users\\you\\code\\app', name: 'app' },
    { root: '/Users/you/code/notes', name: 'notes' },
    { root: '/Users/you/code/just-added', name: 'just-added' },
  ])
})

import { reposFixture, shipFixture } from './fixtures'
import { crumbsOf, deepestWorktree, findFigure, labelOf, stateOf, tokens } from './model'

test('a robot’s breadcrumbs: repo, its captain (opens it), itself with its twin suffix', () => {
  const ship = shipFixture()
  const f = findFigure(ship, 'r-live')!
  expect(labelOf(f)).toBe('#682·a')
  expect(crumbsOf(f, ship)).toEqual([
    { text: 'mnemo-desktop', repo: '/work/mnemo-desktop' },
    { text: '◆ nexus round', go: 'cap-1' },
    { text: '#682·a', here: true },
  ])
})

test('a captain’s breadcrumbs: repo, then itself', () => {
  const ship = shipFixture()
  expect(crumbsOf(findFigure(ship, 'cap-2')!, ship)).toEqual([
    { text: 'mnemo-desktop', repo: '/work/mnemo-desktop' },
    { text: '● triage', here: true },
  ])
})

test('the state in words, its colour a state colour', () => {
  const ship = shipFixture()
  expect(stateOf(findFigure(ship, 'r-live')!)).toEqual({ text: 'working', tone: 'working' })
  expect(stateOf(findFigure(ship, 'r-done')!)).toEqual({ text: 'ready', tone: 'done' })
  expect(stateOf(findFigure(ship, 'cap-3')!)).toEqual({ text: 'ended', tone: 'idle' })
})

test('context sizes read short', () => {
  expect([tokens(640), tokens(9_400), tokens(182_300)]).toEqual(['640', '9.4k', '182k'])
})

test('a session’s worktree is the deepest one known holding its cwd', () => {
  const known = [...reposFixture[0].worktrees.map((w) => w.path), '/work/mnemo-desktop-wt-682']
  expect(deepestWorktree('/work/mnemo-desktop-wt-682/src', known)).toBe('/work/mnemo-desktop-wt-682')
  expect(deepestWorktree('/work/mnemo-desktop/src/nexus', [...known, '/work/mnemo-desktop/src'])).toBe('/work/mnemo-desktop/src')
  expect(deepestWorktree('/elsewhere', known)).toBe('/elsewhere')
})

import { captainOf, child, parent, reposFixture, robotOf, shipFixture } from './fixtures'
import { CHILD_ENDED, crumbsOf, deepestWorktree, ENDED, findFigure, labelOf, OUTSIDE, openingOf, repoOf, stateOf, tokens } from './model'

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
  expect(stateOf({ kind: 'captain', captain: captainOf({ pose: 'asleep', idleMs: 3 * 3_600_000 }), place: null })).toEqual({ text: 'asleep', tone: 'idle' })
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

test('a session’s pane is the layout’s when the fleet does not know it yet: no false "runs outside the app"', () => {
  const ship = shipFixture()
  expect(openingOf('cap-2', ship, reposFixture)).toMatchObject({ ref: null, tab: { readOnly: OUTSIDE } })
  const inLayout = (sid: string) => (sid === 'cap-2' ? 14 : sid === 's-live' ? 15 : null)
  expect(openingOf('cap-2', ship, reposFixture, inLayout)).toMatchObject({ ref: { pane: 14 }, tab: { readOnly: null } })
  expect(openingOf('r-live', ship, reposFixture, inLayout)?.ref).toEqual({ pane: 15 })
  // The fleet still answers where the layout does not.
  expect(openingOf('cap-1', ship, reposFixture, inLayout)?.ref).toEqual({ pane: 7 })
})

test('a session’s repo: the fleet’s repo holding its cwd, else the <repo> a -wt- folder folds into', () => {
  const repos = [{ ...reposFixture[0], worktrees: [...reposFixture[0].worktrees, { ...reposFixture[0].worktrees[0], path: '/trees/feature-x', kind: 'dispatched' as const }] }]
  expect(repoOf('/trees/feature-x/src', repos)).toEqual({ root: '/work/mnemo-desktop', name: 'mnemo-desktop' })
  expect(repoOf('/work/mnemo-wt-90/src', repos)).toEqual({ root: '/work/mnemo', name: 'mnemo' })
  expect(repoOf('/elsewhere/plain', repos)).toBeNull()
})

test('a Grok row’s read-only tab reads its conversation from its own Grok home; a Claude row’s tab is as it was', () => {
  const claude = shipFixture()
  const before = ['cap-2', 'cap-3', 'r-done'].map((id) => openingOf(id, claude, reposFixture)!.tab)
  expect(before.map((t) => t.readOnly)).toEqual([OUTSIDE, ENDED, CHILD_ENDED])
  for (const t of before) expect(Object.keys(t).sort()).toEqual(['cwd', 'id', 'key', 'kind', 'label', 'readOnly', 'sessionId'])
  // A Claude row that names its account (more than one account) is a Claude transcript still.
  const named = shipFixture()
  named.decks[0].captains[1] = captainOf({ id: 'cap-2', parent: parent({ session_id: 'cap-2', account_env: { config_dir: '/Users/you/.claude-work', kind: 'claude' } }), pose: 'idle' })
  expect(openingOf('cap-2', named, reposFixture)!.tab).not.toHaveProperty('source')

  const ship = shipFixture()
  ship.decks[0].captains[1] = captainOf({ id: 'cap-2', parent: parent({ session_id: 'cap-2', account: 'gw', account_env: { config_dir: '/Users/you/.grok-work', kind: 'grok' } }), pose: 'idle' })
  ship.decks[0].hangar[0] = robotOf({
    child: child({ id: 'r-done', session_id: 's-done', live: false, account: 'grok', account_env: { config_dir: null, kind: 'grok' } }),
    label: '#401',
    twin: null,
    state: 'done',
    zone: 'hangar',
  })
  expect(openingOf('cap-2', ship, reposFixture)).toMatchObject({ ref: null, tab: { readOnly: OUTSIDE, sessionId: 'cap-2', source: { kind: 'grok', home: '/Users/you/.grok-work' } } })
  // `~/.grok`'s account runs with GROK_HOME unset: every Grok home is searched.
  expect(openingOf('r-done', ship, reposFixture)).toMatchObject({ ref: null, tab: { readOnly: CHILD_ENDED, sessionId: 's-done', source: { kind: 'grok', home: null } } })
})

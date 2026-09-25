import { activePath, agentDot, countByState, prLabel, shortAgo, sidebarOrder, summarize, summaryGroups, waveSummary, worktreeStatus } from './model'
import { agent, repo, tree } from './testing'

test('a worktree’s status is its most urgent agent’s: waiting on you, then working, then done', () => {
  expect(worktreeStatus([agent('a', 'done'), agent('b', 'needs-you'), agent('c', 'working')])).toBe('permission')
  expect(worktreeStatus([agent('a', 'done'), agent('c', 'working'), agent('d', 'idle')])).toBe('working')
  expect(worktreeStatus([agent('d', 'idle'), agent('a', 'done')])).toBe('done')
  expect(worktreeStatus([agent('d', 'idle')])).toBe('inactive')
  expect(worktreeStatus([])).toBe('inactive')
})

test('an agent waiting on you shows what it waits for', () => {
  expect(agentDot(agent('a', 'needs-you', { waitingFor: 'permission' }))).toBe('permission')
  expect(agentDot(agent('a', 'needs-you', { waitingFor: 'question' }))).toBe('waiting')
  expect(agentDot(agent('a', 'working'))).toBe('working')
  expect(agentDot(agent('a', 'idle'))).toBe('idle')
})

test('the pill groups agents by state, attention first, and says so in words', () => {
  const agents = [agent('a', 'idle'), agent('b', 'working'), agent('c', 'needs-you'), agent('d', 'working'), agent('e', 'needs-you', { waitingFor: 'permission' })]
  expect(summaryGroups(agents)).toEqual([
    { state: 'permission', count: 1 },
    { state: 'waiting', count: 1 },
    { state: 'working', count: 2 },
    { state: 'idle', count: 1 },
  ])
  expect(summarize(agents)).toBe('5 agents: 1 needs permission, 1 waiting for input, 2 working, 1 idle')
})

test('the dashboard entry counts every agent of every repo by state', () => {
  const repos = [
    repo('/r/a', [tree('/r/a', { agents: [agent('1', 'working'), agent('2', 'needs-you')] }), tree('/r/a-wt-x', { agents: [agent('3', 'working')] })]),
    repo('/r/b', [tree('/r/b', { agents: [agent('4', 'done')] })]),
  ]
  expect(countByState(repos)).toEqual({ 'needs-you': 1, working: 2, done: 1, idle: 0 })
})

test('sidebar order is the cards top to bottom, without the folded repos', () => {
  const repos = [repo('/r/a', [tree('/r/a'), tree('/r/a-wt-x')]), repo('/r/b', [tree('/r/b')]), repo('/r/c', [tree('/r/c')])]
  expect(sidebarOrder(repos, new Set()).map((w) => w.path)).toEqual(['/r/a', '/r/a-wt-x', '/r/b', '/r/c'])
  expect(sidebarOrder(repos, new Set(['/r/b'])).map((w) => w.path)).toEqual(['/r/a', '/r/a-wt-x', '/r/c'])
})

test('with the Dispatch tab there, dispatched children leave the order; workspaces made by hand stay', () => {
  const repos = [repo('/r/a', [tree('/r/a', { kind: 'main' }), tree('/r/a-wt-child', { kind: 'dispatched' }), tree('/r/a-wt-x')])]
  expect(sidebarOrder(repos, new Set()).map((w) => w.path)).toEqual(['/r/a', '/r/a-wt-child', '/r/a-wt-x'])
  expect(sidebarOrder(repos, new Set(), true).map((w) => w.path)).toEqual(['/r/a', '/r/a-wt-x'])
})

test('a wave line says its most urgent count, with the glyph a card would use for it', () => {
  expect(waveSummary({ needsYou: 2, working: 1, done: 3 })).toEqual({ state: 'permission', text: '2 need you' })
  expect(waveSummary({ needsYou: 1, working: 0, done: 0 })).toEqual({ state: 'permission', text: '1 needs you' })
  expect(waveSummary({ needsYou: 0, working: 1, done: 3 })).toEqual({ state: 'working', text: '1 working' })
  expect(waveSummary({ needsYou: 0, working: 0, done: 3 })).toEqual({ state: 'done', text: '3 done' })
  expect(waveSummary({ needsYou: 0, working: 0, done: 0 })).toEqual({ state: 'idle', text: 'idle' })
})

test('the active card is the worktree on screen, else the first repo’s main checkout', () => {
  const repos = [repo('/r/a', [tree('/r/a-wt-x'), tree('/r/a', { kind: 'main' })]), repo('/r/b', [tree('/r/b', { kind: 'main' })])]
  expect(activePath('/r/b/', repos)).toBe('/r/b')
  expect(activePath(null, repos)).toBe('/r/a')
  expect(activePath(null, [])).toBeNull()
})

test('ages are short: now, minutes, hours, days', () => {
  const now = 1_000_000_000
  expect(shortAgo(now - 59_000, now)).toBe('now')
  expect(shortAgo(now - 60_000, now)).toBe('1m')
  expect(shortAgo(now - 3_599_000, now)).toBe('59m')
  expect(shortAgo(now - 3_600_000, now)).toBe('1h')
  expect(shortAgo(now - 86_400_000, now)).toBe('1d')
  expect(shortAgo(now + 5_000, now)).toBe('now')
})

test('a PR says its state, and its checks only while open', () => {
  expect(prLabel({ number: 7, state: 'merged', checks: 'failing' })).toBe('PR #7: Merged')
  expect(prLabel({ number: 7, state: 'draft', checks: 'passing' })).toBe('PR #7: Draft')
  expect(prLabel({ number: 7, state: 'closed', checks: null })).toBe('PR #7: Closed')
  expect(prLabel({ number: 7, state: 'open', checks: 'failing' })).toBe('PR #7 checks: Failing')
  expect(prLabel({ number: 7, state: 'open', checks: 'pending' })).toBe('PR #7 checks: Pending')
  expect(prLabel({ number: 7, state: 'open', checks: 'passing' })).toBe('PR #7 checks: Passing')
  expect(prLabel({ number: 7, state: 'open', checks: null })).toBe('PR #7: Open')
})

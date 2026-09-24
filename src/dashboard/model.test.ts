import type { AgentNode, RepoNode, WorktreeNode } from '../fleet/types'
import { askOf, BUCKETS, cardsOf, columnSignature, formatAgo, groupByBucket, transitionName } from './model'

const agent = (sessionId: string, state: AgentNode['state'], since = 0, extra: Partial<AgentNode> = {}): AgentNode => ({
  sessionId,
  paneId: null,
  state,
  waitingFor: state === 'needs-you' ? 'permission' : null,
  title: `title ${sessionId}`,
  since,
  ...extra,
})

const tree = (path: string, agents: AgentNode[], extra: Partial<WorktreeNode> = {}): WorktreeNode => ({
  path,
  name: path.split('/').pop()!,
  branch: null,
  kind: 'workspace',
  agents,
  pr: null,
  unread: false,
  ...extra,
})

const repo = (root: string, worktrees: WorktreeNode[]): RepoNode => ({ root, name: root.split('/').pop()!, worktrees })

test('the columns are Needs you, Working, Done, Idle, in that order', () => {
  expect(BUCKETS).toEqual(['needs-you', 'working', 'done', 'idle'])
})

test('every agent of every worktree of every repo is a card, carrying where it lives', () => {
  const cards = cardsOf([
    repo('/c/app', [
      tree('/c/app', [agent('a', 'working', 5, { paneId: 3 })], { kind: 'main', branch: 'main' }),
      tree('/c/app-wt-fix', [agent('b', 'idle')], { kind: 'dispatched', pr: { number: 7, state: 'open', checks: null } }),
    ]),
    repo('/c/lib', [tree('/c/lib', [agent('c', 'done')], { kind: 'main' })]),
  ])
  expect(cards.map((c) => [c.sessionId, c.bucket, c.repoName, c.worktreeName, c.kind])).toEqual([
    ['a', 'working', 'app', 'app', 'main'],
    ['b', 'idle', 'app', 'app-wt-fix', 'dispatched'],
    ['c', 'done', 'lib', 'lib', 'main'],
  ])
  expect(cards[0]).toMatchObject({ paneId: 3, since: 5, branch: 'main', worktreePath: '/c/app', repoRoot: '/c/app', title: 'title a' })
  expect(cards[1].pr).toEqual({ number: 7, state: 'open', checks: null })
})

test('an unread worktree makes its finished and waiting agents unseen, not the ones working or idle', () => {
  const cards = cardsOf([
    repo('/r', [tree('/r', [agent('d', 'done'), agent('n', 'needs-you'), agent('w', 'working'), agent('i', 'idle')], { unread: true })]),
  ])
  expect(Object.fromEntries(cards.map((c) => [c.sessionId, c.unseen]))).toEqual({ d: true, n: true, w: false, i: false })
  const read = cardsOf([repo('/r', [tree('/r', [agent('d', 'done')], { unread: false })])])
  expect(read[0].unseen).toBe(false)
})

test('each column holds its own cards, the most recently moved first', () => {
  const cards = cardsOf([repo('/r', [tree('/r', [agent('old', 'working', 10), agent('new', 'working', 30), agent('mid', 'working', 20), agent('x', 'done', 1)])])])
  const g = groupByBucket(cards)
  expect(g.working.map((c) => c.sessionId)).toEqual(['new', 'mid', 'old'])
  expect(g.done.map((c) => c.sessionId)).toEqual(['x'])
  expect(g['needs-you']).toEqual([])
  expect(g.idle).toEqual([])
})

test('the column signature changes when a card moves, comes or goes, and not when its content does', () => {
  const at = (state: AgentNode['state'], title = 't') => cardsOf([repo('/r', [tree('/r', [agent('a', state, 0, { title }), agent('b', 'idle')])])])
  const base = columnSignature(at('working'))
  expect(columnSignature(at('working', 'renamed'))).toBe(base)
  expect(columnSignature(at('done'))).not.toBe(base)
  expect(columnSignature(cardsOf([repo('/r', [tree('/r', [agent('a', 'working')])])]))).not.toBe(base)
  // Order of listing is not a move.
  expect(columnSignature([...at('working')].reverse())).toBe(base)
})

test('ages are coarse', () => {
  const now = 10 * 24 * 3600_000
  expect(formatAgo(now - 59_000, now)).toBe('just now')
  expect(formatAgo(now - 60_000, now)).toBe('1m')
  expect(formatAgo(now - 59 * 60_000, now)).toBe('59m')
  expect(formatAgo(now - 3600_000, now)).toBe('1h')
  expect(formatAgo(now - 24 * 3600_000, now)).toBe('1d')
  expect(formatAgo(now + 5000, now)).toBe('just now')
})

test('a waiting agent says what it waits for; nobody else asks anything', () => {
  expect(askOf({ bucket: 'needs-you', waitingFor: 'question' })).toBe('Asked you a question')
  expect(askOf({ bucket: 'needs-you', waitingFor: 'permission' })).toBe('Waiting on your permission')
  expect(askOf({ bucket: 'working', waitingFor: null })).toBeNull()
})

test('a transition name is a valid custom ident', () => {
  expect(transitionName('ab:12/x.y')).toBe('agentcard-ab-12-x-y')
})

import type { RepoNode, WorktreeNode } from '../fleet/types'
import { matchText, rankProjects, splitPathHead, type ProjectOption } from './match'
import { projectOf, projectOptions } from './projects'
import { closeNewWorkspace, composerStore, openNewWorkspace } from './open'

const opt = (id: string, displayName: string): ProjectOption => ({ id, displayName, detail: id, mainBranch: 'main', taken: [] })

test('a substring hits every offset of it, earlier scoring higher; else characters in order', () => {
  expect(matchText('mnemo-desktop', 'desk')).toEqual({ hits: [6, 7, 8, 9], score: 994 })
  expect(matchText('mnemo-desktop', 'mdp')?.hits).toEqual([0, 6, 12])
  expect(matchText('mnemo', 'x')).toBeNull()
  expect(matchText('mnemo', '  ')).toEqual({ hits: [], score: 0 })
})

test('projects rank name hits over path hits, and an empty query keeps the order', () => {
  const opts = [opt('/gh/zeta', 'zeta'), opt('/gh/app', 'app'), opt('/work/apple', 'apple')]
  expect(rankProjects(opts, '').map((m) => m.option.id)).toEqual(['/gh/zeta', '/gh/app', '/work/apple'])
  expect(rankProjects(opts, 'app').map((m) => m.option.id)).toEqual(['/gh/app', '/work/apple'])
  const byPath = rankProjects(opts, 'work')
  expect(byPath.map((m) => m.option.id)).toEqual(['/work/apple'])
  expect(byPath[0].detailHits).toEqual([1, 2, 3, 4])
  expect(byPath[0].nameHits).toEqual([])
})

test('a path keeps its last two segments apart', () => {
  expect(splitPathHead('/Users/x/code/services/api')).toEqual({ head: '/Users/x/code/', tail: 'services/api' })
  expect(splitPathHead('/api')).toBeNull()
})

const wt = (over: Partial<WorktreeNode>): WorktreeNode => ({ path: '/gh/app', name: 'app', branch: 'main', kind: 'main', agents: [], pr: null, unread: false, ...over })
const repos: RepoNode[] = [
  { root: '/gh/app', name: 'app', worktrees: [wt({}), wt({ path: '/gh/app-wt-workspace-1', name: 'workspace-1', branch: 'feat', kind: 'workspace' })] },
  { root: '/gh/lib', name: 'lib', worktrees: [] },
]

test('projects come from the fleet, with the main branch and the names in use', () => {
  expect(projectOptions(repos)).toEqual([
    { id: '/gh/app', displayName: 'app', detail: '/gh/app', mainBranch: 'main', taken: ['main', 'app', 'feat', 'workspace-1'] },
    { id: '/gh/lib', displayName: 'lib', detail: '/gh/lib', mainBranch: null, taken: [] },
  ])
})

test('the project on screen is the repo holding the shown worktree', () => {
  expect(projectOf(repos, '/gh/app-wt-workspace-1')).toBe('/gh/app')
  expect(projectOf(repos, '/gh/lib')).toBe('/gh/lib')
  expect(projectOf(repos, '/elsewhere')).toBeNull()
  expect(projectOf(repos, null)).toBeNull()
})

test('openNewWorkspace opens the composer for its request, each open a fresh one', () => {
  closeNewWorkspace()
  const seq = composerStore.getState().seq
  openNewWorkspace()
  expect(composerStore.getState()).toEqual({ request: {}, seq: seq + 1 })
  openNewWorkspace({ repo: '/gh/app', issue: { number: 4, title: 'T' } })
  expect(composerStore.getState()).toEqual({ request: { repo: '/gh/app', issue: { number: 4, title: 'T' } }, seq: seq + 2 })
  closeNewWorkspace()
  expect(composerStore.getState().request).toBeNull()
})

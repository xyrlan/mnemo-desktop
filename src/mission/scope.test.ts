import { createStore, type Pane, type State } from '../layout/store'
import type { PtyClient } from '../pty/client'
import { focusedCwd, paneCwd, repoOfCwd, scopeRepos } from './scope'
import { snapshot } from './fixtures'
import { pruneSnapshot } from './types'

const pty: PtyClient = { spawn: async () => 1, write: async () => {}, resize: async () => {}, kill: async () => {}, onExit: async () => () => {} }

test('paneCwd: terminal cwd, editor root or file folder, mission child worktree', () => {
  expect(paneCwd({ id: 1, view: 'terminal', cwd: '/a' }, snapshot)).toBe('/a')
  expect(paneCwd({ id: 1, view: 'terminal' }, snapshot)).toBeUndefined()
  expect(paneCwd({ id: -1, view: 'editor', props: { path: '/p/src/x.ts', root: '/p' } }, snapshot)).toBe('/p')
  expect(paneCwd({ id: -1, view: 'editor', props: { path: '/p/src/x.ts' } }, snapshot)).toBe('/p/src')
  expect(paneCwd({ id: -1, view: 'mission', props: { id: '094c6a03' } }, snapshot)).toBe('/Users/me/github/mnemo-desktop-wt-c-vault')
  expect(paneCwd({ id: -1, view: 'mission', props: { id: 'gone' } }, snapshot)).toBeUndefined()
  expect(paneCwd({ id: -1, view: 'browser', props: { url: 'https://x' } }, snapshot)).toBeUndefined()
})

test('repoOfCwd matches the root, subdirectories, and worktrees beside it', () => {
  expect(repoOfCwd(snapshot, '/Users/me/github/mnemo-desktop')?.name).toBe('mnemo-desktop')
  expect(repoOfCwd(snapshot, '/Users/me/github/mnemo-desktop/src/mission')?.name).toBe('mnemo-desktop')
  // Sibling worktree of a child: not under the root, but under the child's cwd.
  expect(repoOfCwd(snapshot, '/Users/me/github/mnemo-desktop-wt-c-vault/src')?.name).toBe('mnemo-desktop')
  expect(repoOfCwd(snapshot, '/Users/me/github/mnemo-issue-40')?.name).toBe('mnemo')
  // A prefix of a name is not a parent directory.
  expect(repoOfCwd(snapshot, '/Users/me/github/mnemo-desktop-other')).toBeUndefined()
  expect(repoOfCwd(snapshot, '/Users/me/notes2')).toBeUndefined()
  expect(repoOfCwd(snapshot, '/tmp')).toBeUndefined()
  expect(repoOfCwd(snapshot, undefined)).toBeUndefined()
})

test('repoOfCwd prefers the deepest match', () => {
  const nested = { ...snapshot, repos: [...snapshot.repos, { root: '/Users/me/github/mnemo/vendor/lib', name: 'lib', parents: [], missions: [], children: [] }] }
  expect(repoOfCwd(nested, '/Users/me/github/mnemo/vendor/lib/src')?.name).toBe('lib')
  expect(repoOfCwd(nested, '/Users/me/github/mnemo/vendor')?.name).toBe('mnemo')
})

test('scopeRepos narrows to the focused repo and falls back to all when none resolved', () => {
  expect(scopeRepos(snapshot, 'repo', '/Users/me/github/mnemo')).toEqual({ repos: [snapshot.repos[1]], effective: 'repo' })
  expect(scopeRepos(snapshot, 'repo', undefined)).toEqual({ repos: snapshot.repos, effective: 'all' })
  expect(scopeRepos(snapshot, 'all', '/Users/me/github/mnemo')).toEqual({ repos: snapshot.repos, effective: 'all' })
})

test('scopeRepos on a pruned snapshot: the focused repo with nothing recent shows empty, not all', () => {
  const stale = { ...snapshot, repos: snapshot.repos.map((r) => (r.name === 'notes' ? { ...r, parents: [] } : r)) }
  const pruned = pruneSnapshot(stale)
  expect(scopeRepos(pruned, 'repo', '/Users/me/notes')).toEqual({ repos: [], effective: 'repo' })
})

function withPanes(panes: Pane[], focused: number): Pick<State, 'tabs' | 'activeTab' | 'panes'> {
  const root = panes.slice(1).reduce<State['tabs'][number]['root']>(
    (acc, p) => ({ kind: 'split', dir: 'row', ratio: 0.5, children: [acc, { kind: 'leaf', pane: p.id }] }),
    { kind: 'leaf', pane: panes[0].id },
  )
  return { tabs: [{ id: 't', root, focused }], activeTab: 't', panes: Object.fromEntries(panes.map((p) => [p.id, p])) }
}

test('focusedCwd: the focused pane first, else another pane of the active tab', () => {
  const term: Pane = { id: 1, view: 'terminal', cwd: '/Users/me/github/mnemo' }
  const cockpit: Pane = { id: -1, view: 'cockpit', props: {} }
  const mission: Pane = { id: -2, view: 'mission', props: { id: 'a43d3832' } }
  expect(focusedCwd(withPanes([term, mission], -2), snapshot)).toBe('/Users/me/github/mnemo-desktop-wt-c-cockpit')
  expect(focusedCwd(withPanes([term, cockpit], -1), snapshot)).toBe('/Users/me/github/mnemo')
  expect(focusedCwd(withPanes([cockpit], -1), snapshot)).toBeUndefined()
  expect(focusedCwd({ tabs: [], activeTab: '', panes: {} }, snapshot)).toBeUndefined()
})

test('focusedCwd against the real layout store', async () => {
  const app = createStore(pty)
  await app.getState().newTab()
  app.getState().setCwd(1, '/Users/me/github/mnemo-desktop-wt-c-vault')
  expect(repoOfCwd(snapshot, focusedCwd(app.getState(), snapshot))?.name).toBe('mnemo-desktop')
})

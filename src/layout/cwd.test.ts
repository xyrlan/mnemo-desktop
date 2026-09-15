import { cwdForNewShell } from './cwd'
import type { Pane, State } from './store'
import { leaf, type Node } from './tree'
import { snapshot } from '../mission/fixtures'

const tab = (root: Node, focused: number) => ({ tabs: [{ id: 't', root, focused }], activeTab: 't' })
const panes = (...ps: Pane[]): State['panes'] => Object.fromEntries(ps.map((p) => [p.id, p]))
const row = (a: number, b: number): Node => ({ kind: 'split', dir: 'row', ratio: 0.5, children: [leaf(a), leaf(b)] })

test('a focused terminal: its OSC 7 cwd', () => {
  const s = { ...tab(leaf(1), 1), panes: panes({ id: 1, view: 'terminal', cwd: '/repo/src' }) }
  expect(cwdForNewShell(s, snapshot, '/elsewhere')).toBe('/repo/src')
})

test('a focused editor: its tree root', () => {
  const s = { ...tab(leaf(-1), -1), panes: panes({ id: -1, view: 'editor', props: { root: '/repo', path: '/repo/src/a.ts' } }) }
  expect(cwdForNewShell(s, snapshot, null)).toBe('/repo')
})

test("a focused mission pane: its child's worktree", () => {
  const s = { ...tab(leaf(-1), -1), panes: panes({ id: -1, view: 'mission', props: { id: '094c6a03' } }) }
  expect(cwdForNewShell(s, snapshot, null)).toBe('/Users/me/github/mnemo-desktop-wt-c-vault')
})

test('a focused pane without a directory: a sibling terminal', () => {
  const s = {
    ...tab(row(-1, 2), -1),
    panes: panes({ id: -1, view: 'browser', props: { url: 'https://x' } }, { id: 2, view: 'terminal', cwd: '/repo' }),
  }
  expect(cwdForNewShell(s, snapshot, null)).toBe('/repo')
})

test('Home: the selected repo, even with tabs open behind it', () => {
  const s = { ...tab(leaf(1), 1), activeTab: '', panes: panes({ id: 1, view: 'terminal', cwd: '/repo/src' }) }
  expect(cwdForNewShell(s, snapshot, '/Users/me/github/mnemo')).toBe('/Users/me/github/mnemo')
})

test('nothing known: undefined, so the core starts in the home directory', () => {
  expect(cwdForNewShell({ tabs: [], activeTab: '', panes: {} }, snapshot, null)).toBeUndefined()
  const s = { ...tab(leaf(1), 1), panes: panes({ id: 1, view: 'terminal' }) }
  expect(cwdForNewShell(s, snapshot, '/Users/me/github/mnemo')).toBeUndefined()
})

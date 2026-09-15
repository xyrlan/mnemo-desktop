import { boardRoot, knownRoots } from './root'
import { snapshot } from '../mission/fixtures'
import type { State } from '../layout/store'

const layout = (cwd?: string): Pick<State, 'tabs' | 'activeTab' | 'panes'> =>
  cwd
    ? { tabs: [{ id: 't', root: { kind: 'leaf', pane: 1 }, focused: 1 }], activeTab: 't', panes: { 1: { id: 1, view: 'terminal', cwd } as never } }
    : { tabs: [], activeTab: '', panes: {} }

test('focused repo from the snapshot, then Home, then the first repo with sessions', () => {
  const home = { repos: [{ root: '/gh/other' }, { root: '/gh/other/nested' }], selected: '/gh/picked' }
  expect(boardRoot(layout('/Users/me/github/mnemo-issue-40'), snapshot, home)).toBe('/Users/me/github/mnemo')
  expect(boardRoot(layout('/gh/other/nested/src'), snapshot, home)).toBe('/gh/other/nested')
  expect(boardRoot(layout('/tmp'), snapshot, home)).toBe('/gh/picked')
  expect(boardRoot(layout(), snapshot, { repos: [], selected: null })).toBe('/Users/me/github/mnemo-desktop')
  expect(boardRoot(layout(), { repos: [], errors: [], at: '' }, { repos: [], selected: null })).toBeUndefined()
})

test('known roots put the current one first and never repeat', () => {
  expect(knownRoots(snapshot, { repos: [{ root: '/Users/me/notes' }, { root: '/gh/x' }], selected: null }, '/gh/x')).toEqual([
    '/gh/x',
    '/Users/me/github/mnemo-desktop',
    '/Users/me/github/mnemo',
    '/Users/me/notes',
  ])
})

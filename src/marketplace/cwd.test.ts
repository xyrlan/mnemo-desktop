import { importCwd } from './cwd'
import type { Node } from '../layout/tree'

const node = (n: number | Node): Node => (typeof n === 'number' ? { kind: 'leaf', pane: n } : n)
const split = (a: number | Node, b: number | Node): Node => ({ kind: 'split', dir: 'row', ratio: 0.5, children: [node(a), node(b)] })

test('the focused terminal wins', () => {
  const s = {
    tabs: [{ id: 't', root: split(1, 2), focused: 2 }],
    activeTab: 't',
    panes: { 1: { id: 1, view: 'terminal', cwd: '/a' }, 2: { id: 2, view: 'terminal', cwd: '/b' } },
  }
  expect(importCwd(s)).toBe('/b')
})

test('with the marketplace focused, a terminal in the tab is used before an editor', () => {
  const s = {
    tabs: [{ id: 't', root: split(-1, split(-2, 1)), focused: -1 }],
    activeTab: 't',
    panes: {
      [-1]: { id: -1, view: 'marketplace' },
      [-2]: { id: -2, view: 'editor', props: { path: '/repo/src/x.ts', root: '/repo' } },
      1: { id: 1, view: 'terminal', cwd: '/term' },
    },
  }
  expect(importCwd(s)).toBe('/term')
})

test('falls back to the editor root, then the editor file directory', () => {
  const tabs = [{ id: 't', root: split(-1, -2), focused: -1 }]
  const withRoot = {
    tabs,
    activeTab: 't',
    panes: { [-1]: { id: -1, view: 'marketplace' }, [-2]: { id: -2, view: 'editor', props: { path: '/repo/a.ts', root: '/repo' } } },
  }
  expect(importCwd(withRoot)).toBe('/repo')
  const noRoot = { ...withRoot, panes: { ...withRoot.panes, [-2]: { id: -2, view: 'editor', props: { path: '/repo/src/a.ts' } } } }
  expect(importCwd(noRoot)).toBe('/repo/src')
})

test('a terminal in another tab is the last resort; undefined when nothing knows a cwd', () => {
  const s = {
    tabs: [
      { id: 't', root: { kind: 'leaf', pane: -1 } as Node, focused: -1 },
      { id: 'u', root: { kind: 'leaf', pane: 3 } as Node, focused: 3 },
    ],
    activeTab: 't',
    panes: { [-1]: { id: -1, view: 'marketplace' }, 3: { id: 3, view: 'terminal', cwd: '/other' } },
  }
  expect(importCwd(s)).toBe('/other')
  expect(importCwd({ ...s, panes: { [-1]: { id: -1, view: 'marketplace' }, 3: { id: 3, view: 'terminal' } } })).toBeUndefined()
  expect(importCwd({ tabs: [], activeTab: '', panes: {} })).toBeUndefined()
})

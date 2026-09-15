import { terminalCwd } from './pr'
import type { Node } from '../layout/tree'

const split = (a: number, b: number): Node => ({
  kind: 'split',
  dir: 'row',
  ratio: 0.5,
  children: [{ kind: 'leaf', pane: a }, { kind: 'leaf', pane: b }],
})

test('uses the focused terminal', () => {
  const s = {
    tabs: [{ id: 't', root: split(1, 2), focused: 2 }],
    activeTab: 't',
    panes: { 1: { id: 1, view: 'terminal', cwd: '/a' }, 2: { id: 2, view: 'terminal', cwd: '/b' } },
  }
  expect(terminalCwd(s)).toBe('/b')
})

test('falls back to a terminal in the tab when a browser is focused', () => {
  const s = {
    tabs: [{ id: 't', root: split(1, -1), focused: -1 }],
    activeTab: 't',
    panes: { 1: { id: 1, view: 'terminal', cwd: '/a' }, [-1]: { id: -1, view: 'browser' } },
  }
  expect(terminalCwd(s)).toBe('/a')
})

test('undefined when nothing reported a cwd', () => {
  const s = {
    tabs: [{ id: 't', root: split(1, -1), focused: 1 }],
    activeTab: 't',
    panes: { 1: { id: 1, view: 'terminal' }, [-1]: { id: -1, view: 'browser' } },
  }
  expect(terminalCwd(s)).toBeUndefined()
  expect(terminalCwd({ tabs: [], activeTab: '', panes: {} })).toBeUndefined()
})

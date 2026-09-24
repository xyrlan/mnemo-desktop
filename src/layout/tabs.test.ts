import { dropOnGroup, groupLabel, paneAccent, paneClaude, paneForSession, paneLabel, tabLabel } from './tabs'
import { accentHue, repoAccent } from '../home/repo-color'
import { leaves, type Node, type PaneId, type Side } from './tree'
import type { Pane, Tab } from './store'
import { desktop, mnemo, notes, parent, snapshot } from '../mission/fixtures'
import type { Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import type { Zone } from '../chrome/drag'

const home: HomeSnapshot = { repos: [], clone_base: '', errors: [], protected: 0 }
const L = (pane: PaneId): Node => ({ kind: 'leaf', pane })
const S = (dir: 'row' | 'col', a: Node, b: Node): Node => ({ kind: 'split', dir, ratio: 0.5, children: [a, b] })

const DESKTOP = '/Users/me/github/mnemo-desktop'
const term = (id: PaneId, cwd: string, over: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', cwd, ...over })

test('a pane is labelled by what runs in it and where, whether or not its tab focuses it', () => {
  const pane = term(1, '/Users/me/scratch', { title: 'vim notes.md' })
  expect(paneLabel(pane, snapshot, home)).toEqual({ name: 'vim notes.md', sub: 'scratch' })
  expect(paneLabel(pane, snapshot, home, { repo: 'dotfiles', branch: 'main' })).toEqual({
    name: 'vim notes.md',
    sub: 'dotfiles · main',
  })
  // The parent session sitting in that cwd is busy, so the pane says so.
  expect(paneLabel(term(2, DESKTOP), snapshot, home).state).toBe('working')
  expect(paneClaude({ id: -1, view: 'cockpit', props: {} }, snapshot)).toBeUndefined()
})

test("a tab of one pane is still labelled by that pane, and the user's name for it still wins", () => {
  const panes: Record<PaneId, Pane> = { 1: term(1, '/Users/me/scratch', { title: 'vim notes.md' }) }
  const tab: Tab = { id: 't1', root: L(1), focused: 1 }
  expect(tabLabel(tab, panes, snapshot, home)).toEqual(paneLabel(panes[1], snapshot, home))
  expect(tabLabel({ ...tab, name: 'triage' }, panes, snapshot, home).name).toBe('triage')
})

test('a group is named after itself and counted, never after one of its panes', () => {
  const panes: Record<PaneId, Pane> = { 1: term(1, '/Users/me/scratch'), 2: term(2, '/Users/me/elsewhere') }
  const tab: Tab = { id: 't1', root: S('row', L(1), L(2)), focused: 1 }
  expect(groupLabel(tab, panes, snapshot)).toEqual({ name: 'group', sub: '2 panes' })
  expect(groupLabel({ ...tab, name: 'triage' }, panes, snapshot)).toEqual({ name: 'triage', sub: '2 panes' })
  // Moving focus to the other pane does not rename the group: that is the thing this replaces.
  expect(groupLabel({ ...tab, focused: 2 }, panes, snapshot)).toEqual(groupLabel(tab, panes, snapshot))
})

test('a group carries the dot of the loudest thing running in it', () => {
  const waiting: Snapshot = {
    ...snapshot,
    repos: [desktop, { ...mnemo, parents: [parent({ session_id: 'b', status: 'waiting for input', cwd: '/Users/me/github/mnemo' })] }, notes],
  }
  const panes: Record<PaneId, Pane> = { 1: term(1, DESKTOP), 2: term(2, '/Users/me/github/mnemo'), 3: term(3, '/nowhere') }
  const of = (root: Node) => groupLabel({ id: 't', root, focused: 1 }, panes, waiting).state
  expect(of(S('row', L(1), L(3)))).toBe('working')
  // Blocked outranks working, whichever way round the two panes sit.
  expect(of(S('row', L(1), L(2)))).toBe('blocked')
  expect(of(S('row', L(2), L(1)))).toBe('blocked')
  expect(of(S('row', L(3), L(3)))).toBeUndefined()
})

test("a pane's accent is its repo's, the lens's own colour, and a worktree of it counts as that repo", () => {
  expect(paneAccent(term(1, DESKTOP), snapshot)).toBe(repoAccent(DESKTOP))
  expect(paneAccent(term(2, '/Users/me/github/mnemo-desktop-wt-c-vault/src'), snapshot)).toBe(repoAccent(DESKTOP))
  expect(paneAccent(term(3, '/Users/me/github/mnemo'), snapshot)).not.toBe(repoAccent(DESKTOP))
  // Outside every repo the snapshot knows, the folder itself keys the colour.
  expect(paneAccent(term(4, '/Users/me/scratch'), snapshot)).toBe(repoAccent('/Users/me/scratch'))
  // A view in no directory has no accent at all.
  expect(paneAccent({ id: -1, view: 'vault', props: {} }, snapshot)).toBeUndefined()
  expect(paneAccent(undefined, snapshot)).toBeUndefined()
  // The hue is one of the lens's, so the two surfaces cannot drift apart.
  expect(accentHue(DESKTOP) % 36).toBe(15 % 36)
})

/** A store stub that records what a drop asked for. */
function fakeStore(tabs: Tab[]) {
  const calls: string[] = []
  return {
    calls,
    tabs,
    swapPanes: (a: PaneId, b: PaneId) => void calls.push(`swap ${a} ${b}`),
    movePane: (from: PaneId, to: PaneId, side: Side, tab?: string) => void calls.push(`move ${from} ${to} ${side} ${tab ?? '-'}`),
  }
}

const group: Tab = { id: 't1', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [L(1), L(2)] }, focused: 1 }
const alone: Tab = { id: 't2', root: L(3), focused: 3 }

test('a drop inside a pane’s own group is the workspace’s own drop: centre swaps, an edge moves', () => {
  for (const [zone, want] of [['center', 'swap 1 2'], ['left', 'move 1 2 left -'], ['down', 'move 1 2 down -']] as [Zone, string][]) {
    const s = fakeStore([group, alone])
    dropOnGroup(s, 1, 2, zone)
    expect(s.calls).toEqual([want])
  }
})

test('a drop onto another group names that group, and its centre means beside rather than swap', () => {
  const s = fakeStore([group, alone])
  dropOnGroup(s, 1, 3, 'center')
  dropOnGroup(s, 1, 3, 'up')
  dropOnGroup(s, 3, 2, 'left')
  expect(s.calls).toEqual(['move 1 3 right t2', 'move 1 3 up t2', 'move 3 2 left t1'])
})

test('a drop on a pane’s own line, or on one no tab holds, does nothing', () => {
  const s = fakeStore([group, alone])
  dropOnGroup(s, 1, 1, 'center')
  dropOnGroup(s, 1, 99, 'left')
  expect(s.calls).toEqual([])
  expect(leaves(group.root)).toEqual([1, 2])
})

describe('paneForSession', () => {
  const shown: Tab = { id: 'a', root: L(1), focused: 1 }
  const hidden: Tab = { id: 'b', root: L(2), focused: 2 }
  const panes = { 1: term(1, DESKTOP), 2: term(2, '/Users/me/github/mnemo', { sessionId: 's2' }) }

  test('finds a session running in a worktree that is not on screen', () => {
    const s = { tabs: [shown], panes, parked: { '/Users/me/github/mnemo': { tabs: [hidden] } } }
    expect(paneForSession(s, { session_id: 's2', cwd: '' })).toBe(2)
    expect(paneForSession(s, { session_id: null, cwd: '/Users/me/github/mnemo/' })).toBe(2)
  })

  test('a pane record no tab lays out is not a match', () => {
    expect(paneForSession({ tabs: [shown], panes, parked: {} }, { session_id: 's2', cwd: '' })).toBeNull()
  })
})

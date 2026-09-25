import type { GroupNode, Tab, WorktreeLayout } from './store'
import { dropTab, groupIds, groupToward, moveTabIn, targetGroup, tidy } from './groups'

const g = (group: string): GroupNode => ({ kind: 'group', group })
const row = (a: GroupNode, b: GroupNode, ratio = 0.5): GroupNode => ({ kind: 'split', dir: 'row', ratio, children: [a, b] })
const col = (a: GroupNode, b: GroupNode, ratio = 0.5): GroupNode => ({ kind: 'split', dir: 'col', ratio, children: [a, b] })
const tab = (id: string, pane = 0): Tab => ({ id, root: { kind: 'leaf', pane }, focused: pane })

/** A layout of groups named by their tabs: `{ A: ['a1', 'a2'] }` is group A holding a1 and a2. */
function layout(root: GroupNode, held: Record<string, string[]>, activeGroup: string, activeTab = held[activeGroup][0]): WorktreeLayout {
  const groups = Object.fromEntries(Object.entries(held).map(([id, tabs]) => [id, { id, tabs, activeTab: tabs[0] }]))
  groups[activeGroup] = { ...groups[activeGroup], activeTab }
  const tabs = groupIds(root).flatMap((id) => held[id].map((t) => tab(t)))
  return { tabs, activeTab, groups, groupRoot: root, activeGroup }
}
let n = 0
const fresh = () => `new-${++n}`

test('groupToward finds the nearest group wholly on a side, across the tree', () => {
  // A | (B / C), and D under all of them.
  const root = col(row(g('A'), col(g('B'), g('C'))), g('D'), 0.7)
  expect(groupToward(root, 'A', 'right')).toBe('B')
  expect(groupToward(root, 'C', 'left')).toBe('A')
  expect(groupToward(root, 'B', 'down')).toBe('C')
  expect(groupToward(root, 'C', 'down')).toBe('D')
  // Of the three above D, the one whose middle is nearest its own.
  expect(groupToward(root, 'D', 'up')).toBe('C')
  expect(groupToward(root, 'A', 'left')).toBeUndefined()
  expect(groupToward(null, 'A', 'left')).toBeUndefined()
})

test('tidy hands back a whole layout as it is, and makes one of anything else', () => {
  const whole = layout(row(g('A'), g('B')), { A: ['a1'], B: ['b1', 'b2'] }, 'B', 'b2')
  expect(tidy(whole, fresh)).toBe(whole)
  // Tabs out of order are put in the groups' order.
  const shuffled = tidy({ ...whole, tabs: [...whole.tabs].reverse() }, fresh)
  expect(shuffled.tabs.map((t) => t.id)).toEqual(['a1', 'b1', 'b2'])
  // A group listed twice, or missing, or empty, goes; the active tab brings its group with it.
  const odd = tidy({ ...whole, groupRoot: row(g('A'), row(g('Z'), row(g('B'), g('A')))), activeTab: 'a1', activeGroup: 'B' }, fresh)
  expect(odd.groupRoot).toEqual(row(g('A'), g('B')))
  expect([odd.activeGroup, odd.activeTab]).toEqual(['A', 'a1'])
  // An active tab no tab has is none: Home.
  expect(tidy({ ...whole, activeTab: 'nope' }, fresh)).toMatchObject({ activeTab: '', activeGroup: 'B' })
})

test('a group that collapses hands its place and, when active, the focus to its sibling', () => {
  // (A / B) | C: closing B's only tab leaves A where the column was.
  const l = layout(row(col(g('A'), g('B')), g('C')), { A: ['a1'], B: ['b1'], C: ['c1'] }, 'B')
  const out = dropTab(l, 'b1')
  expect(out.groupRoot).toEqual(row(g('A'), g('C')))
  expect([out.activeGroup, out.activeTab]).toEqual(['A', 'a1'])
  // The sibling a subtree: its first group.
  const wide = layout(row(g('A'), col(g('B'), g('C'))), { A: ['a1'], B: ['b1'], C: ['c1'] }, 'A')
  expect(dropTab(wide, 'a1')).toMatchObject({ groupRoot: col(g('B'), g('C')), activeGroup: 'B', activeTab: 'b1' })
  // A group that is not active collapsing leaves the focus alone, Home included.
  expect(dropTab({ ...wide, activeTab: '' }, 'c1')).toMatchObject({ groupRoot: row(g('A'), g('B')), activeGroup: 'A', activeTab: '' })
})

test('moving a group’s only tab next to where it already is changes nothing', () => {
  const l = layout(row(g('A'), g('B')), { A: ['a1'], B: ['b1', 'b2'] }, 'A')
  expect(moveTabIn(l, 'a1', { group: 'A', side: 'down' }, fresh)).toBe(l)
  expect(moveTabIn(l, 'a1', { group: 'B', side: 'left' }, fresh)).toBe(l)
  expect(moveTabIn(l, 'a1', { group: 'A', index: 5 }, fresh)).toBe(l)
  expect(moveTabIn(l, 'a1', { group: 'nope' }, fresh)).toBe(l)
  // Onto B's far edge it is a move: A collapses, and the tab has a group right of B.
  const out = moveTabIn(l, 'a1', { group: 'B', side: 'right' }, fresh)
  expect(groupIds(out.groupRoot)).toEqual(['B', out.activeGroup])
  expect(out.activeTab).toBe('a1')
})

test('a file opens where a file shows when the active group shows a terminal', () => {
  const l = layout(row(g('A'), g('B')), { A: ['a1'], B: ['b1'] }, 'A')
  l.tabs = [{ ...tab('a1', 1) }, { ...tab('b1', -1) }]
  const panes = { 1: { id: 1, view: 'terminal' }, [-1]: { id: -1, view: 'doc' } }
  expect(targetGroup(l, panes, 'doc')).toBe('B')
  expect(targetGroup(l, panes, 'other')).toBe('A')
  expect(targetGroup({ ...l, activeGroup: 'B' }, panes, 'doc')).toBe('B')
})

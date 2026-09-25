import type { Group, GroupNode, Tab, WorktreeLayout } from '../layout/store'
import { changes, dropAt, edgeZone, halfOf, moveFor, resolveTabDrop, rowSlot, type GroupRects, type Rect } from './drop'

const r = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height })

describe('edgeZone', () => {
  const panel = r(0, 0, 1000, 636)
  const body = r(0, 36, 1000, 600)
  test('the outer 20% of the width on the left and right', () => {
    expect(edgeZone(panel, body, { x: 199, y: 300 })).toBe('left')
    expect(edgeZone(panel, body, { x: 801, y: 300 })).toBe('right')
    expect(edgeZone(panel, body, { x: 201, y: 300 })).toBeNull()
  })
  test("the outer 20% of the body's height at its top and bottom", () => {
    expect(edgeZone(panel, body, { x: 500, y: 36 + 119 })).toBe('up')
    expect(edgeZone(panel, body, { x: 500, y: 36 + 481 })).toBe('down')
    expect(edgeZone(panel, body, { x: 500, y: 336 })).toBeNull()
  })
  test('never over the tab row, even at its ends', () => {
    expect(edgeZone(panel, body, { x: 10, y: 20 })).toBeNull()
    expect(edgeZone(panel, body, { x: 990, y: 20 })).toBeNull()
  })
})

test('rowSlot: before the first tab whose middle the point is left of; past them all, after the last', () => {
  const tabs = [r(0, 0, 100, 36), r(100, 0, 100, 36)]
  expect(rowSlot(tabs, 10)).toBe(0)
  expect(rowSlot(tabs, 60)).toBe(1)
  expect(rowSlot(tabs, 160)).toBe(2)
  expect(rowSlot(tabs, 900)).toBe(2)
  expect(rowSlot([], 10)).toBe(0)
})

/** Two groups side by side, 500px each (no seam, for round numbers): `a` holds tabs 1 and 2,
 *  `b` holds tab 3. */
const RECTS: GroupRects[] = [
  { group: 'a', panel: r(0, 0, 500, 636), row: r(0, 0, 500, 36), body: r(0, 36, 500, 600), tabs: [{ id: 't1', rect: r(0, 0, 180, 36) }, { id: 't2', rect: r(180, 0, 180, 36) }] },
  { group: 'b', panel: r(500, 0, 500, 636), row: r(500, 0, 500, 36), body: r(500, 36, 500, 600), tabs: [{ id: 't3', rect: r(500, 0, 180, 36) }] },
]

test('dropAt: a row first, then a body’s outer band, then its middle; nothing outside every group', () => {
  expect(dropAt(RECTS, { x: 200, y: 10 })).toEqual({ kind: 'row', group: 'a', slot: 1 })
  expect(dropAt(RECTS, { x: 700, y: 10 })).toEqual({ kind: 'row', group: 'b', slot: 1 })
  expect(dropAt(RECTS, { x: 950, y: 300 })).toEqual({ kind: 'split', group: 'b', side: 'right' })
  expect(dropAt(RECTS, { x: 750, y: 600 })).toEqual({ kind: 'split', group: 'b', side: 'down' })
  expect(dropAt(RECTS, { x: 750, y: 300 })).toEqual({ kind: 'body', group: 'b' })
  expect(dropAt(RECTS, { x: 1200, y: 300 })).toBeNull()
})

const tab = (id: string): Tab => ({ id, root: { kind: 'leaf', pane: Number(id.slice(1)) }, focused: Number(id.slice(1)) })
const group = (id: string, tabs: string[]): Group => ({ id, tabs, activeTab: tabs[0] })
function layout(groups: Group[], root: GroupNode): WorktreeLayout {
  return {
    tabs: groups.flatMap((g) => g.tabs.map(tab)),
    activeTab: groups[0].activeTab,
    groups: Object.fromEntries(groups.map((g) => [g.id, g])),
    groupRoot: root,
    activeGroup: groups[0].id,
  }
}
const SIDE: GroupNode = { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'group', group: 'a' }, { kind: 'group', group: 'b' }] }
const L = layout([group('a', ['t1', 't2']), group('b', ['t3'])], SIDE)

describe('moveFor', () => {
  test('in its own row, `index` is where the tab ends up once it has left its place', () => {
    const three = layout([group('a', ['t1', 't2', 't4'])], { kind: 'group', group: 'a' })
    expect(moveFor(three, 't1', { kind: 'row', group: 'a', slot: 3 })).toEqual({ group: 'a', index: 2 })
    expect(moveFor(three, 't4', { kind: 'row', group: 'a', slot: 0 })).toEqual({ group: 'a', index: 0 })
    // Either side of itself is its own place.
    expect(moveFor(three, 't2', { kind: 'row', group: 'a', slot: 1 })).toBeNull()
    expect(moveFor(three, 't2', { kind: 'row', group: 'a', slot: 2 })).toBeNull()
  })
  test("into another group's row at the slot; to the end of another group's body; never into its own body", () => {
    expect(moveFor(L, 't1', { kind: 'row', group: 'b', slot: 0 })).toEqual({ group: 'b', index: 0 })
    expect(moveFor(L, 't1', { kind: 'body', group: 'b' })).toEqual({ group: 'b' })
    expect(moveFor(L, 't1', { kind: 'body', group: 'a' })).toBeNull()
  })
  test('an edge is a new group on that side', () => {
    expect(moveFor(L, 't1', { kind: 'split', group: 'a', side: 'down' })).toEqual({ group: 'a', side: 'down' })
  })
})

test("changes: the store's own no-op rules, so a drop that would change nothing shows nothing", () => {
  // A group's only tab onto its own edge, or onto the facing edge of the group beside it.
  expect(changes(L, 't3', { group: 'b', side: 'left' })).toBe(false)
  expect(changes(L, 't3', { group: 'a', side: 'right' })).toBe(false)
  // Onto the far edge, or with a tab left behind, it does.
  expect(changes(L, 't3', { group: 'a', side: 'left' })).toBe(true)
  expect(changes(L, 't1', { group: 'a', side: 'right' })).toBe(true)
})

test('resolveTabDrop: where it lands and the move, only when that changes the layout', () => {
  expect(resolveTabDrop(L, RECTS, 't1', { x: 950, y: 300 })).toEqual({ drop: { kind: 'split', group: 'b', side: 'right' }, to: { group: 'b', side: 'right' } })
  expect(resolveTabDrop(L, RECTS, 't1', { x: 700, y: 10 })).toEqual({ drop: { kind: 'row', group: 'b', slot: 1 }, to: { group: 'b', index: 1 } })
  expect(resolveTabDrop(L, RECTS, 't3', { x: 520, y: 300 })).toBeNull()
  expect(resolveTabDrop(L, RECTS, 't3', { x: 750, y: 300 })).toBeNull()
  expect(resolveTabDrop(L, RECTS, 't1', { x: 100, y: 10 })).toBeNull()
})

test('halfOf: the half of the panel a new group on that side takes', () => {
  const p = r(100, 0, 400, 600)
  expect(halfOf(p, 'left')).toEqual(r(100, 0, 200, 600))
  expect(halfOf(p, 'right')).toEqual(r(300, 0, 200, 600))
  expect(halfOf(p, 'up')).toEqual(r(100, 0, 400, 300))
  expect(halfOf(p, 'down')).toEqual(r(100, 300, 400, 300))
})

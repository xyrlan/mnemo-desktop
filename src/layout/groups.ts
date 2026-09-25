import type { Group, GroupNode, Pane, Tab, TabTarget, WorktreeLayout } from './store'
import { leaves, neighbour, type Dir, type Path, type Rect, type Side } from './tree'

// A worktree's workbench as Orca draws it (`src/shared/tab-types.ts`, `store/slices/tabs/` at
// 122b8c25): a split tree of groups, each an ordered set of tabs with one of them shown. These
// are the moves on one layout; the store applies them to whichever worktree holds the tab.

/** The seam between two groups is held between these, as a pane split's is on screen. */
export const GROUP_RATIO_MIN = 0.15
export const GROUP_RATIO_MAX = 0.85
export const clampGroupRatio = (r: number) => Math.min(GROUP_RATIO_MAX, Math.max(GROUP_RATIO_MIN, r))

export const EMPTY_LAYOUT: WorktreeLayout = { tabs: [], activeTab: '', groups: {}, groupRoot: null, activeGroup: '' }

export const groupLeaf = (group: string): GroupNode => ({ kind: 'group', group })

/** The groups of a tree, left to right and top to bottom. */
export function groupIds(n: GroupNode | null): string[] {
  if (!n) return []
  return n.kind === 'group' ? [n.group] : [...groupIds(n.children[0]), ...groupIds(n.children[1])]
}

/** `n` with group `id` replaced by `by`; the same tree when `id` is not in it. */
function replaceGroup(n: GroupNode, id: string, by: GroupNode): GroupNode {
  if (n.kind === 'group') return n.group === id ? by : n
  const [a, b] = n.children
  const a2 = replaceGroup(a, id, by)
  const b2 = a2 === a ? replaceGroup(b, id, by) : b
  return a2 === a && b2 === b ? n : { ...n, children: [a2, b2] }
}

/** `n` without group `id`: its parent split collapses into the sibling, which takes the whole of
 *  its space. Null when it was the last group. */
function removeGroup(n: GroupNode, id: string): GroupNode | null {
  if (n.kind === 'group') return n.group === id ? null : n
  const [a, b] = n.children
  const a2 = removeGroup(a, id)
  if (a2 === null) return b
  const b2 = removeGroup(b, id)
  if (b2 === null) return a
  return a2 === a && b2 === b ? n : { ...n, children: [a2, b2] }
}

/** The group that takes group `id`'s place when it goes: its sibling, or the first group of it. */
function heirOf(n: GroupNode, id: string): string | undefined {
  if (n.kind === 'group') return undefined
  const [a, b] = n.children
  if (a.kind === 'group' && a.group === id) return groupIds(b)[0]
  if (b.kind === 'group' && b.group === id) return groupIds(a)[0]
  return heirOf(a, id) ?? heirOf(b, id)
}

/** The group next to group `id` on `side` within their own split, when that is a group alone:
 *  the one a single tab dropped on that edge of `id` came from, if the drop changes nothing. */
function besideInSplit(n: GroupNode, id: string, side: Side): string | undefined {
  if (n.kind === 'group') return undefined
  const [a, b] = n.children
  if (n.dir === axisOf(side)) {
    const after = side === 'right' || side === 'down'
    if (after && a.kind === 'group' && a.group === id && b.kind === 'group') return b.group
    if (!after && b.kind === 'group' && b.group === id && a.kind === 'group') return a.group
  }
  return besideInSplit(a, id, side) ?? besideInSplit(b, id, side)
}

const axisOf = (side: Side): Dir => (side === 'left' || side === 'right' ? 'row' : 'col')

/** The split at `path` with its ratio set, held between GROUP_RATIO_MIN and GROUP_RATIO_MAX. */
export function groupRatioAt(n: GroupNode, path: Path, ratio: number): GroupNode {
  if (n.kind === 'group') return n
  if (path.length === 0) {
    const r = clampGroupRatio(ratio)
    return r === n.ratio ? n : { ...n, ratio: r }
  }
  const [head, ...rest] = path
  const child = groupRatioAt(n.children[head], rest, ratio)
  if (child === n.children[head]) return n
  const children: [GroupNode, GroupNode] = [n.children[0], n.children[1]]
  children[head] = child
  return { ...n, children }
}

const BOX: Rect = { x: 0, y: 0, w: 1e6, h: 1e6 }

/** Each group's box when the tree is laid out in `box` (seams ignored). */
export function groupBoxes(n: GroupNode, box: Rect = BOX, out: Map<string, Rect> = new Map()): Map<string, Rect> {
  if (n.kind === 'group') {
    out.set(n.group, box)
    return out
  }
  const [a, b] = n.children
  if (n.dir === 'row') {
    const w = box.w * n.ratio
    groupBoxes(a, { ...box, w }, out)
    groupBoxes(b, { ...box, x: box.x + w, w: box.w - w }, out)
  } else {
    const h = box.h * n.ratio
    groupBoxes(a, { ...box, h }, out)
    groupBoxes(b, { ...box, y: box.y + h, h: box.h - h }, out)
  }
  return out
}

/** The group on `side` of group `id` (the nearest of those wholly on that side), if any. */
export function groupToward(n: GroupNode | null, id: string, side: Side): string | undefined {
  return (n && neighbour(id, side, groupBoxes(n))) ?? undefined
}

/** The group holding tab `id`. */
export function groupOf(l: Pick<WorktreeLayout, 'groups'>, id: string): string | undefined {
  for (const g in l.groups) if (l.groups[g].tabs.includes(id)) return g
  return undefined
}

/** Whether a tab holds terminals only: the one kind of tab that splits inside itself. A pane the
 *  store does not know counts as a terminal, which is what a tab of it was before groups. */
export function isTerminalTab(t: Tab, panes: Record<number, Pane>): boolean {
  return leaves(t.root).every((p) => panes[p] === undefined || panes[p].view === 'terminal')
}

type Layoutish<T extends { id: string }> = {
  tabs: T[]
  activeTab?: string
  groups?: Record<string, Group>
  groupRoot?: GroupNode | null
  activeGroup?: string
}
type Tidy<T extends { id: string }> = { tabs: T[]; activeTab: string; groups: Record<string, Group>; groupRoot: GroupNode | null; activeGroup: string }

const sameRecord = <V,>(a: Record<string, V>, b: Record<string, V>) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/** `l` made whole, the same object when it already is:
 *  - every tab in exactly one group of the tree, and `tabs` in the order the groups hold them;
 *  - no group that is empty, missing, or not in the tree (an empty one collapses);
 *  - each group showing one of its own tabs;
 *  - `activeGroup` a group of the tree, and `activeTab` either `''` or the tab it shows.
 *
 *  Tabs no group lists join the active group, after its own. So a layout whose groups list none
 *  of its tabs (one set with `setState({ tabs, activeTab })`) is one group holding them all, in
 *  `tabs` order. `fresh` names a group made for them. */
export function tidy<T extends { id: string }, L extends Layoutish<T>>(l: L, fresh: () => string): L & Tidy<T> {
  const tabs = l.tabs
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const given = l.groups ?? {}
  const groups: Record<string, Group> = {}
  const seen = new Set<string>()
  const prune = (n: GroupNode): GroupNode | null => {
    if (n.kind === 'group') {
      const g = given[n.group]
      if (!g || groups[n.group]) return null
      const kept: string[] = []
      for (const id of g.tabs) {
        if (!byId.has(id) || seen.has(id)) continue
        seen.add(id)
        kept.push(id)
      }
      if (kept.length === 0) return null
      const same = kept.length === g.tabs.length && g.id === n.group && kept.includes(g.activeTab)
      groups[n.group] = same ? g : { id: n.group, tabs: kept, activeTab: kept.includes(g.activeTab) ? g.activeTab : kept[0] }
      return n
    }
    const a = prune(n.children[0])
    const b = prune(n.children[1])
    if (!a || !b) return a ?? b
    return a === n.children[0] && b === n.children[1] ? n : { ...n, children: [a, b] }
  }
  let root = l.groupRoot ? prune(l.groupRoot) : null
  let activeGroup = l.activeGroup ?? ''
  let activeTab = l.activeTab ?? ''

  const loose: string[] = []
  for (const t of tabs) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    loose.push(t.id)
  }
  if (loose.length) {
    const into = groups[activeGroup] ? activeGroup : groupIds(root)[0]
    if (into === undefined) {
      const id = fresh()
      root = groupLeaf(id)
      groups[id] = { id, tabs: loose, activeTab: loose[0] }
    } else groups[into] = { ...groups[into], tabs: [...groups[into].tabs, ...loose] }
  }

  if (!root) {
    activeGroup = ''
    activeTab = ''
  } else {
    const holder = activeTab ? groupOf({ groups }, activeTab) : undefined
    if (holder !== undefined) {
      activeGroup = holder
      if (groups[holder].activeTab !== activeTab) groups[holder] = { ...groups[holder], activeTab }
    } else {
      activeTab = ''
      if (!groups[activeGroup]) activeGroup = groupIds(root)[0]
    }
  }

  const order = groupIds(root).flatMap((g) => groups[g].tabs)
  const inOrder = order.length === tabs.length && order.every((id, i) => tabs[i].id === id)
  const sameGroups = l.groups !== undefined && sameRecord(l.groups, groups)
  if (inOrder && sameGroups && root === (l.groupRoot ?? null) && activeGroup === l.activeGroup && activeTab === l.activeTab) return l as L & Tidy<T>
  return {
    ...l,
    tabs: inOrder ? tabs : order.map((id) => byId.get(id)!),
    activeTab,
    groups: sameGroups ? l.groups! : groups,
    groupRoot: root,
    activeGroup,
  }
}

/** `l` with `tabs` in the order its groups hold them. */
function sortTabs(l: WorktreeLayout): WorktreeLayout {
  const order = groupIds(l.groupRoot).flatMap((g) => l.groups[g].tabs)
  if (order.length === l.tabs.length && order.every((id, i) => l.tabs[i].id === id)) return l
  const byId = new Map(l.tabs.map((t) => [t.id, t]))
  return { ...l, tabs: order.flatMap((id) => byId.get(id) ?? []) }
}

/** Shows tab `id`: its group becomes the active group, with the tab shown in it. */
export function showTab(l: WorktreeLayout, id: string): WorktreeLayout {
  const g = groupOf(l, id)
  if (g === undefined) return l
  const group = l.groups[g]
  if (l.activeTab === id && l.activeGroup === g && group.activeTab === id) return l
  return { ...l, activeTab: id, activeGroup: g, groups: group.activeTab === id ? l.groups : { ...l.groups, [g]: { ...group, activeTab: id } } }
}

/** `l` with tab `id` changed by `fn`. */
export function withTab(l: WorktreeLayout, id: string, fn: (t: Tab) => Tab): WorktreeLayout {
  let changed = false
  const tabs = l.tabs.map((t) => {
    if (t.id !== id) return t
    const next = fn(t)
    changed ||= next !== t
    return next
  })
  return changed ? { ...l, tabs } : l
}

/** Tab `t` kept: no longer a preview the next file replaces. */
export function kept(t: Tab): Tab {
  if (!t.preview) return t
  const { preview: _preview, ...rest } = t
  return rest
}

/** `l` with `tab` in group `g` at `index` (at its end by default; else the active group), not
 *  shown. A layout with no group gets one holding it. */
export function putTab(l: WorktreeLayout, tab: Tab, g: string | undefined, index: number | undefined, fresh: () => string): WorktreeLayout {
  const into = g !== undefined && l.groups[g] ? g : l.groups[l.activeGroup] ? l.activeGroup : groupIds(l.groupRoot)[0]
  if (into === undefined) {
    const id = fresh()
    return { ...l, tabs: [...l.tabs, tab], groups: { [id]: { id, tabs: [tab.id], activeTab: tab.id } }, groupRoot: groupLeaf(id), activeGroup: id }
  }
  const group = l.groups[into]
  const ids = group.tabs.slice()
  ids.splice(Math.max(0, Math.min(index ?? ids.length, ids.length)), 0, tab.id)
  return sortTabs({ ...l, tabs: [...l.tabs, tab], groups: { ...l.groups, [into]: { ...group, tabs: ids } } })
}

/** `l` with `tabs` in its active group, after its own, and nothing else shown. */
export function joinTabs(l: WorktreeLayout, tabs: Tab[], fresh: () => string): WorktreeLayout {
  return tabs.reduce((out, t) => putTab(out, t, undefined, undefined, fresh), l)
}

/** `l` with `tab` in a new group `id` on `side` of group `g`, which splits evenly to hold it. */
function splitWith(l: WorktreeLayout, g: string, side: Side, id: string, tab: Tab): WorktreeLayout {
  const first = side === 'left' || side === 'up'
  const node: GroupNode = { kind: 'split', dir: axisOf(side), ratio: 0.5, children: first ? [groupLeaf(id), groupLeaf(g)] : [groupLeaf(g), groupLeaf(id)] }
  const groups = { ...l.groups, [id]: { id, tabs: [tab.id], activeTab: tab.id } }
  return sortTabs({ ...l, tabs: [...l.tabs, tab], groups, groupRoot: replaceGroup(l.groupRoot!, g, node) })
}

/** `l` with `tab` in the group on `side` of group `g`, at its end: "to the side". That group is
 *  made, beside `g`, when there is none. Not shown. */
export function putBeside(l: WorktreeLayout, tab: Tab, g: string, side: Side, fresh: () => string): WorktreeLayout {
  if (!l.groups[g]) return putTab(l, tab, undefined, undefined, fresh)
  const there = groupToward(l.groupRoot, g, side)
  return there !== undefined ? putTab(l, tab, there, undefined, fresh) : splitWith(l, g, side, fresh(), tab)
}

/** `l` without tab `id` (its panes are the caller's to close or keep). Its group shows its left
 *  neighbour in its place. A group left with no tab collapses, and when it was the active group
 *  its sibling takes the space and becomes active; the worktree's last tab leaves no group. */
export function dropTab(l: WorktreeLayout, id: string): WorktreeLayout {
  const tabs = l.tabs.filter((t) => t.id !== id)
  const g = groupOf(l, id)
  if (g === undefined) return tabs.length === l.tabs.length ? l : { ...l, tabs }
  const group = l.groups[g]
  const idx = group.tabs.indexOf(id)
  const left = group.tabs.filter((t) => t !== id)
  if (left.length) {
    const shown = group.activeTab === id ? left[Math.max(0, idx - 1)] : group.activeTab
    return { ...l, tabs, groups: { ...l.groups, [g]: { ...group, tabs: left, activeTab: shown } }, activeTab: l.activeTab === id ? shown : l.activeTab }
  }
  const root = l.groupRoot && removeGroup(l.groupRoot, g)
  if (!root) return { ...l, tabs, activeTab: '', groups: {}, groupRoot: null, activeGroup: '' }
  const groups = { ...l.groups }
  delete groups[g]
  const activeGroup = l.activeGroup === g ? heirOf(l.groupRoot!, g) ?? groupIds(root)[0] : l.activeGroup
  const activeTab = l.activeTab === id ? groups[activeGroup].activeTab : l.activeTab
  return { ...l, tabs, groups, groupRoot: root, activeGroup, activeTab }
}

/** `l` with tab `id` moved (see `Actions.moveTab`); the same layout when the move changes nothing. */
export function moveTabIn(l: WorktreeLayout, id: string, to: TabTarget, fresh: () => string): WorktreeLayout {
  const from = groupOf(l, id)
  const target = l.groups[to.group]
  const tab = l.tabs.find((t) => t.id === id)
  if (from === undefined || !target || !tab) return l
  const source = l.groups[from]
  if ('side' in to) {
    // A group's only tab dropped on its own edge, or on the facing edge of the group beside it,
    // would make a group that collapses straight back into what was there (Orca).
    const alone = source.tabs.length === 1
    if (alone && (from === to.group || besideInSplit(l.groupRoot!, to.group, to.side) === from)) return l
    const out = dropTab(l, id)
    return showTab(splitWith(out, to.group, to.side, fresh(), kept(tab)), id)
  }
  if (from === to.group) {
    const ids = source.tabs.filter((t) => t !== id)
    ids.splice(Math.max(0, Math.min(to.index ?? ids.length, ids.length)), 0, id)
    if (ids.every((t, i) => source.tabs[i] === t)) return l
    return sortTabs(withTab({ ...l, groups: { ...l.groups, [from]: { ...source, tabs: ids } } }, id, kept))
  }
  return showTab(putTab(dropTab(l, id), kept(tab), to.group, to.index, fresh), id)
}

/** The preview tab of group `g`: the one the next preview opened there replaces. */
export function previewIn(l: WorktreeLayout, g: string | undefined): Tab | undefined {
  const ids = g === undefined ? undefined : l.groups[g]?.tabs
  return ids && l.tabs.find((t) => t.preview && ids.includes(t.id))
}

/** Where a document of `view` opens (Orca's `resolveEditorOpenTargetGroupId`, without its
 *  "recently had an editor" step): the active group, unless it is showing a terminal; then a
 *  group that is showing a tab of that view, if one is. */
export function targetGroup(l: WorktreeLayout, panes: Record<number, Pane>, view: string): string | undefined {
  const active = l.groups[l.activeGroup]
  if (!active) return undefined
  const shownView = (g: string) => {
    const t = l.tabs.find((x) => x.id === l.groups[g].activeTab)
    return t && panes[t.focused]?.view
  }
  if (shownView(l.activeGroup) !== 'terminal') return l.activeGroup
  return groupIds(l.groupRoot).find((g) => g !== l.activeGroup && shownView(g) === view) ?? l.activeGroup
}

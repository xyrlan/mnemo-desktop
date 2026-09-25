import type { Node, PaneId } from './tree'
import { closeLeaf, leaf, leaves } from './tree'
import type { Group, GroupNode } from './store'
import { clampGroupRatio, groupIds, tidy } from './groups'

/** What `~/.mnemo-desktop/workspace.json` holds: for each open worktree, its tabs with their split
 *  trees and ratios, the split tree of groups those tabs are in, and what each pane was (never
 *  its PTY, its scrollback or its exit code). Pane ids are the ids of the run that saved it, and
 *  tab and group ids its names for them; `restore` issues new ones. */
export type SavedPane = { view: string; props?: Record<string, unknown>; cwd?: string; title?: string; sessionId?: string; face?: 'conversation' }
export type SavedTab = { id: string; root: Node; focused: PaneId; name?: string; preview?: true }
export type SavedLayout = {
  tabs: SavedTab[]
  panes: Record<string, SavedPane>
  activeTab: string
  groups: Record<string, Group>
  groupRoot: GroupNode | null
  activeGroup: string
}
/** `path: null` is the layout of no worktree: the tabs opened before one was chosen. */
export type SavedWorktree = SavedLayout & { path: string | null }
export type Saved = { version: 3; activeWorktree: string | null; worktrees: SavedWorktree[] }

export const SAVED_VERSION = 3

/** Views that only exist for a moment (a placeholder that opens a real terminal and closes). */
export const TRANSIENT_VIEWS = new Set(['terminal-cmd'])

/** A Claude Code session id is typed into a shell on restore, so nothing but an id gets through. */
export const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined)

function parseNode(x: unknown, seen: Set<PaneId>): Node | null {
  if (!isObj(x)) return null
  if (x.kind === 'leaf') {
    if (!Number.isInteger(x.pane) || seen.has(x.pane as number)) return null
    seen.add(x.pane as number)
    return { kind: 'leaf', pane: x.pane as number }
  }
  if (x.kind !== 'split' || (x.dir !== 'row' && x.dir !== 'col') || !Array.isArray(x.children) || x.children.length !== 2) return null
  const ratio = typeof x.ratio === 'number' && Number.isFinite(x.ratio) ? Math.min(0.9, Math.max(0.1, x.ratio)) : 0.5
  const a = parseNode(x.children[0], seen)
  const b = a && parseNode(x.children[1], seen)
  return a && b ? { kind: 'split', dir: x.dir, ratio, children: [a, b] } : null
}

/** The group tree as saved. A half that cannot be read goes, and the other half takes its place:
 *  its tabs are not lost, they join the active group (`tidy`). */
function parseGroupNode(x: unknown, seen: Set<string>): GroupNode | null {
  if (!isObj(x)) return null
  if (x.kind === 'group') {
    const g = str(x.group)
    if (g === undefined || seen.has(g)) return null
    seen.add(g)
    return { kind: 'group', group: g }
  }
  if (x.kind !== 'split' || (x.dir !== 'row' && x.dir !== 'col') || !Array.isArray(x.children) || x.children.length !== 2) return null
  const ratio = typeof x.ratio === 'number' && Number.isFinite(x.ratio) ? clampGroupRatio(x.ratio) : 0.5
  const a = parseGroupNode(x.children[0], seen)
  const b = parseGroupNode(x.children[1], seen)
  return a && b ? { kind: 'split', dir: x.dir, ratio, children: [a, b] } : a ?? b
}

function parseGroups(x: unknown): Record<string, Group> {
  const out: Record<string, Group> = {}
  if (!isObj(x)) return out
  for (const [id, g] of Object.entries(x)) {
    if (!id || !isObj(g) || !Array.isArray(g.tabs)) continue
    out[id] = { id, tabs: g.tabs.filter((t): t is string => typeof t === 'string'), activeTab: typeof g.activeTab === 'string' ? g.activeTab : '' }
  }
  return out
}

function parsePane(x: unknown): SavedPane | null {
  if (!isObj(x) || !str(x.view) || TRANSIENT_VIEWS.has(x.view as string)) return null
  const p: SavedPane = { view: x.view as string }
  if (isObj(x.props)) p.props = x.props
  if (str(x.cwd)) p.cwd = x.cwd as string
  if (str(x.title)) p.title = x.title as string
  if (typeof x.sessionId === 'string' && SESSION_ID.test(x.sessionId)) p.sessionId = x.sessionId
  if (x.face === 'conversation' && p.view === 'terminal') p.face = 'conversation'
  return p
}

/** Tab `t` as tabs are now: only terminals split inside a tab. A tab that put another view beside
 *  its panes (any file before groups could) is cut apart: its terminals stay in it, and each other
 *  view becomes a tab of its own right after it. With no terminal, the first view keeps the tab. */
function cutApart(t: SavedTab, panes: Record<string, SavedPane>): SavedTab[] {
  const ids = leaves(t.root)
  const others = ids.filter((id) => panes[String(id)].view !== 'terminal')
  if (ids.length < 2 || others.length === 0) return [t]
  let rest: Node | null = t.root
  for (const id of others) rest = rest && closeLeaf(rest, id)
  const parts: SavedTab[] = []
  if (rest) parts.push({ ...t, root: rest, focused: leaves(rest).includes(t.focused) ? t.focused : leaves(rest)[0] })
  for (const id of others) {
    const own = parts.length === 0
    parts.push({ id: own ? t.id : `${t.id}/${id}`, root: leaf(id), focused: id, ...(own && t.name ? { name: t.name } : {}) })
  }
  return parts
}

/** One layout as saved; `read` is false when it held tabs and none of them could be read. */
function parseLayout(v: Record<string, unknown>): { layout: SavedLayout; read: boolean } {
  if (v.tabs !== undefined && !Array.isArray(v.tabs)) throw new Error('workspace.json: tabs is not a list')
  const raw = (v.tabs ?? []) as unknown[]
  const rawPanes = isObj(v.panes) ? v.panes : {}
  const panes: Record<string, SavedPane> = {}
  const tabs: SavedTab[] = []
  const groups = parseGroups(v.groups)
  let activeTab = typeof v.activeTab === 'string' ? v.activeTab : ''
  for (const t of raw) {
    if (!isObj(t)) continue
    let root = parseNode(t.root, new Set())
    if (!root) continue
    for (const id of leaves(root)) {
      const p = parsePane(rawPanes[String(id)])
      if (p) panes[String(id)] = p
      else root = root && closeLeaf(root, id)
      if (!root) break
    }
    if (!root) continue
    const ids = leaves(root)
    const focused = Number.isInteger(t.focused) && ids.includes(t.focused as number) ? (t.focused as number) : ids[0]
    const id = str(t.id) ?? `tab-${ids[0]}`
    // Groups name tabs by id: a second tab of the same id keeps its place under another.
    const tab: SavedTab = { id: tabs.some((x) => x.id === id) ? `${id}#${tabs.length}` : id, root, focused }
    if (str(t.name)) tab.name = t.name as string
    // Only a tab of one pane that is not a terminal is ever a preview.
    if (t.preview === true && ids.length === 1 && panes[String(ids[0])].view !== 'terminal') tab.preview = true
    const parts = cutApart(tab, panes)
    tabs.push(...parts)
    if (parts.length > 1) {
      // The parts sit where the tab sat, and the one holding its focused pane shows in its place.
      const named = parts.map((p) => p.id)
      const focus = parts.find((p) => leaves(p.root).includes(tab.focused))!.id
      for (const g of Object.values(groups)) {
        const at = g.tabs.indexOf(tab.id)
        if (at < 0) continue
        g.tabs = [...g.tabs.slice(0, at), ...named, ...g.tabs.slice(at + 1)]
        if (g.activeTab === tab.id) g.activeTab = focus
      }
      if (activeTab === tab.id) activeTab = focus
    }
  }
  let n = 0
  const fresh = () => {
    let id: string
    do id = `group-${++n}`
    while (groups[id])
    return id
  }
  const groupRoot = parseGroupNode(v.groupRoot, new Set())
  const activeGroup = typeof v.activeGroup === 'string' ? v.activeGroup : ''
  const layout = tidy({ tabs, panes, activeTab, groups, groupRoot, activeGroup }, fresh)
  // A group has at most one preview.
  for (const g of groupIds(layout.groupRoot)) {
    const previews = layout.groups[g].tabs.map((id) => layout.tabs.find((t) => t.id === id)!).filter((t) => t.preview)
    for (const t of previews.slice(1)) delete t.preview
  }
  return { layout, read: raw.length === 0 || tabs.length > 0 }
}

/** The workspace to restore from what `workspace_read` returned. `null` when there is nothing to
 *  restore (no file, no worktree, no tab). A tab that cannot be read is dropped and a pane that
 *  cannot be read leaves its tab; a worktree whose tabs all fail stays open with none. Throws only
 *  when tabs were saved and none of them survived, or the shape is not a workspace at all.
 *
 *  A file from before groups (`version: 2`) reads as one group per worktree holding its tabs in
 *  order, and a file from before worktrees (`version: 1`, its tabs at the top) as the one layout
 *  of no worktree. Either one's tabs that mix a view with other panes are cut apart (`cutApart`). */
export function parseSaved(v: unknown): Saved | null {
  if (!isObj(v)) throw new Error('workspace.json is not an object')
  if (v.worktrees === undefined) {
    if (v.tabs === undefined) return null
    const { layout, read } = parseLayout(v)
    if (!read) throw new Error('workspace.json: no tab could be read')
    return layout.tabs.length ? { version: SAVED_VERSION, activeWorktree: null, worktrees: [{ path: null, ...layout }] } : null
  }
  if (!Array.isArray(v.worktrees)) throw new Error('workspace.json: worktrees is not a list')
  const worktrees: SavedWorktree[] = []
  const seen = new Set<string | null>()
  let saved = false
  let survived = false
  for (const w of v.worktrees) {
    if (!isObj(w)) continue
    const path = w.path === null ? null : str(w.path)
    if (path === undefined || seen.has(path)) continue
    const { layout, read } = parseLayout(w)
    saved ||= layout.tabs.length > 0 || !read
    survived ||= layout.tabs.length > 0
    // No worktree and no tab: nothing to keep open.
    if (path === null && layout.tabs.length === 0) continue
    seen.add(path)
    worktrees.push({ path, ...layout })
  }
  if (saved && !survived) throw new Error('workspace.json: no tab could be read')
  if (worktrees.length === 0) return null
  const named = typeof v.activeWorktree === 'string' || v.activeWorktree === null ? (v.activeWorktree as string | null) : undefined
  const activeWorktree = named !== undefined && seen.has(named) ? named : worktrees[0].path
  return { version: SAVED_VERSION, activeWorktree, worktrees }
}

/** The same tree with every leaf renamed through `map` (leaves missing from it stay). */
export function mapLeaves(n: Node, map: Map<PaneId, PaneId>): Node {
  if (n.kind === 'leaf') return { kind: 'leaf', pane: map.get(n.pane) ?? n.pane }
  return { ...n, children: [mapLeaves(n.children[0], map), mapLeaves(n.children[1], map)] }
}

/** The same group tree with every group renamed through `map`. */
export function mapGroups(n: GroupNode, map: Map<string, string>): GroupNode {
  if (n.kind === 'group') return { kind: 'group', group: map.get(n.group) ?? n.group }
  return { ...n, children: [mapGroups(n.children[0], map), mapGroups(n.children[1], map)] }
}

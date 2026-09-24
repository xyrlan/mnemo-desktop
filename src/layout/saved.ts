import type { Node, PaneId } from './tree'
import { closeLeaf, leaves } from './tree'

/** What `~/.mnemo-desktop/workspace.json` holds: for each open worktree, its tabs with their split
 *  trees and ratios, and what each pane was (never its PTY, its scrollback or its exit code). Pane
 *  ids are the ids of the run that saved it; `restore` issues new ones. */
export type SavedPane = { view: string; props?: Record<string, unknown>; cwd?: string; title?: string; sessionId?: string; face?: 'conversation' }
export type SavedTab = { id: string; root: Node; focused: PaneId; name?: string }
export type SavedLayout = { tabs: SavedTab[]; panes: Record<string, SavedPane>; activeTab: string }
/** `path: null` is the layout of no worktree: the tabs opened before one was chosen. */
export type SavedWorktree = SavedLayout & { path: string | null }
export type Saved = { version: 2; activeWorktree: string | null; worktrees: SavedWorktree[] }

export const SAVED_VERSION = 2

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

/** One layout as saved; `read` is false when it held tabs and none of them could be read. */
function parseLayout(v: Record<string, unknown>): { layout: SavedLayout; read: boolean } {
  if (v.tabs !== undefined && !Array.isArray(v.tabs)) throw new Error('workspace.json: tabs is not a list')
  const raw = (v.tabs ?? []) as unknown[]
  const rawPanes = isObj(v.panes) ? v.panes : {}
  const panes: Record<string, SavedPane> = {}
  const tabs: SavedTab[] = []
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
    const tab: SavedTab = { id: str(t.id) ?? `tab-${ids[0]}`, root, focused }
    if (str(t.name)) tab.name = t.name as string
    tabs.push(tab)
  }
  const activeTab = typeof v.activeTab === 'string' ? v.activeTab : ''
  return { layout: { tabs, panes, activeTab }, read: raw.length === 0 || tabs.length > 0 }
}

/** The workspace to restore from what `workspace_read` returned. `null` when there is nothing to
 *  restore (no file, no worktree, no tab). A tab that cannot be read is dropped and a pane that
 *  cannot be read leaves its tab; a worktree whose tabs all fail stays open with none. Throws only
 *  when tabs were saved and none of them survived, or the shape is not a workspace at all.
 *
 *  A file from before worktrees (`version: 1`, its tabs at the top) reads as the one layout of no
 *  worktree. */
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

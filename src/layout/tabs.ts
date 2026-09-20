import type { Pane, Tab } from './store'
import { leaves, type PaneId, type Side } from './tree'
import type { Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import { paneCwd, repoOfCwd } from '../mission/scope'
import { barInfo, paneParent } from '../chrome/info'
import { repoAccent } from '../home/repo-color'
import { dropPane, type Zone } from '../chrome/drag'

/** What Claude Code in a tab is doing, from its parent row in the mission snapshot. */
export type ClaudeState = 'working' | 'blocked' | 'idle'

export type TabLabel = {
  /** The user's name for the tab, else what runs in its focused pane. */
  name: string
  /** `repo · branch` of the focused pane, empty for views that are in no directory. */
  sub: string
  /** Present only while the focused pane runs Claude Code. */
  state?: ClaudeState
}

export type Git = { repo?: string | null; branch?: string | null }

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

/** `claude agents` statuses: `busy` is working, anything waiting on the user is blocked. */
export function claudeState(status: string): ClaudeState {
  if (status === 'busy') return 'working'
  if (/wait|block|input|permission|approv/i.test(status)) return 'blocked'
  return 'idle'
}

/** Home's title for a session (its first real prompt, else its `claude agents` name). */
export function sessionTitle(home: HomeSnapshot, sessionId: string): string | undefined {
  for (const r of home.repos ?? []) {
    const s = r.sessions.find((x) => x.id === sessionId) ?? r.children.find((x) => x.id === sessionId)
    if (s) return s.title || s.agent || undefined
  }
  return undefined
}

/** A pane named by what runs in it: the Claude session's title, else the terminal's own title,
 *  else its folder; other views by their view (`editor · file`). */
export function paneName(pane: Pane | undefined, snap: Snapshot, home: HomeSnapshot): string {
  if (!pane) return 'shell'
  if (pane.view === 'terminal') {
    const cwd = paneCwd(pane, snap)
    const parent = paneParent(pane, cwd, snap)
    const sid = pane.sessionId ?? parent?.session_id
    const claude = (sid && sessionTitle(home, sid)) || parent?.name
    return claude || pane.title || (cwd && basename(cwd)) || 'shell'
  }
  if (pane.view === 'editor' && typeof pane.props?.path === 'string' && pane.props.path) return `editor · ${basename(pane.props.path)}`
  return pane.view
}

/** What Claude Code is doing in a pane, when a terminal there runs it. */
export function paneClaude(pane: Pane | undefined, snap: Snapshot): ClaudeState | undefined {
  if (pane?.view !== 'terminal') return undefined
  const parent = paneParent(pane, paneCwd(pane, snap), snap)
  return parent ? claudeState(parent.status) : undefined
}

/** Everything one pane's line shows. `git` is what the chrome client said for that pane's cwd. */
export function paneLabel(pane: Pane | undefined, snap: Snapshot, home: HomeSnapshot, git: Git = {}): TabLabel {
  const info = barInfo(pane, snap, git)
  const sub = [info.place, info.branch].filter(Boolean).join(' · ')
  const state = paneClaude(pane, snap)
  return { name: paneName(pane, snap, home), sub, ...(state ? { state } : {}) }
}

/** Everything a sidebar tab row shows. `git` is what the chrome client said for the focused pane's cwd.
 *  Only a tab of one pane is labelled this way: a group of several says so itself (`groupLabel`). */
export function tabLabel(tab: Tab, panes: Record<number, Pane>, snap: Snapshot, home: HomeSnapshot, git: Git = {}): TabLabel {
  const label = paneLabel(panes[tab.focused], snap, home, git)
  return tab.name ? { ...label, name: tab.name } : label
}

/** The dot a group carries, when its panes disagree: whichever of them asks most of you. */
const LOUDEST: ClaudeState[] = ['blocked', 'working', 'idle']

/** A group's own line: its name and how many panes it holds, with the dot of the loudest thing
 *  running in any of them. Never named after one of its panes — each is on a line of its own
 *  underneath, and a label that follows focus is the thing this replaces. */
export function groupLabel(tab: Tab, panes: Record<number, Pane>, snap: Snapshot): TabLabel {
  const ids = leaves(tab.root)
  const states = ids.map((id) => paneClaude(panes[id], snap))
  const state = LOUDEST.find((s) => states.includes(s))
  return { name: tab.name || 'group', sub: `${ids.length} panes`, ...(state ? { state } : {}) }
}

/** The accent a pane's line carries: its repo's, the very colour the lens gives that repo. A pane
 *  in no repo the snapshot knows is keyed by its own directory instead, so two panes sitting in
 *  one folder still agree; a pane in no directory at all (a vault, a cockpit) has no accent. */
export function paneAccent(pane: Pane | undefined, snap: Snapshot): string | undefined {
  const cwd = paneCwd(pane, snap)
  return cwd ? repoAccent(repoOfCwd(snap, cwd)?.root ?? cwd) : undefined
}

/** What letting a dragged pane go over a sidebar line does. Inside the line's own group it is the
 *  workspace's own drop — the centre swaps the two panes, an edge moves `from` to that side of
 *  `to`. Across groups there is no second place to swap into, so the centre means what a new pane
 *  means here, beside it (`split-row`); the pane leaves its group and joins this one. */
export function dropOnGroup(
  s: {
    tabs: Tab[]
    swapPanes(a: PaneId, b: PaneId): void
    movePane(from: PaneId, to: PaneId, side: Side, tab?: string): void
  },
  from: PaneId,
  to: PaneId,
  zone: Zone,
): void {
  if (from === to) return
  const dest = s.tabs.find((t) => leaves(t.root).includes(to))
  if (!dest) return
  if (leaves(dest.root).includes(from)) return dropPane(s, from, to, zone)
  s.movePane(from, to, zone === 'center' ? 'right' : zone, dest.id)
}

const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/'

/** The pane of this window a session runs in: the terminal tagged with its session id, else the
 *  only terminal sitting in exactly its cwd. `null` when it is not open here (or ambiguous). */
export function paneForSession(
  s: { tabs: Tab[]; panes: Record<number, Pane> },
  session: { session_id: string | null; cwd: string },
): number | null {
  const open = s.tabs.flatMap((t) => leaves(t.root)).map((id) => s.panes[id]).filter((p): p is Pane => !!p)
  const tagged = session.session_id ? open.find((p) => p.sessionId === session.session_id) : undefined
  if (tagged) return tagged.id
  if (!session.cwd) return null
  const here = open.filter((p) => p.view === 'terminal' && p.cwd && trimSlash(p.cwd) === trimSlash(session.cwd))
  return here.length === 1 ? here[0].id : null
}

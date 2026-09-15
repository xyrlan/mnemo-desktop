import type { Pane, Tab } from './store'
import { leaves } from './tree'
import type { Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import { paneCwd } from '../mission/scope'
import { barInfo, paneParent } from '../chrome/info'

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

/** Everything a sidebar tab row shows. `git` is what the chrome client said for the focused pane's cwd. */
export function tabLabel(tab: Tab, panes: Record<number, Pane>, snap: Snapshot, home: HomeSnapshot, git: Git = {}): TabLabel {
  const pane = panes[tab.focused]
  const info = barInfo(pane, snap, git)
  const sub = [info.place, info.branch].filter(Boolean).join(' · ')
  const parent = pane?.view === 'terminal' ? paneParent(pane, info.cwd, snap) : undefined
  return { name: tab.name || paneName(pane, snap, home), sub, ...(parent ? { state: claudeState(parent.status) } : {}) }
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

import type { AgentEvent } from '../agents/events'
import { notificationKind } from '../fleet/model'
import type { RepoNode } from '../fleet/types'
import { allChildren, type Snapshot } from '../mission/types'
import { basename, norm, within } from '../path/path'

/** What an agent did that is worth telling you: its turn is `done`, or it waits on a `permission`
 *  or a `question`. */
export type AlertKind = 'done' | 'permission' | 'question'

/** One alert, as the card, the native notification and the sound share it. `worktree` is the
 *  fleet worktree the agent runs in, or `null` when its folder is in none (then `name` is the
 *  folder's). */
export type Alert = {
  sessionId: string
  kind: AlertKind
  worktree: string | null
  name: string
  repo: string | null
  message: string
  at: number
}

export type Place = { path: string; name: string; repo: string }

/** `cwd` is `root` or inside it; `/a/bc` is not inside `/a/b`. */
export function inside(cwd: string, root: string): boolean {
  return within(cwd, root)
}

/** The deepest fleet worktree `cwd` is in — a tree under `.claude/worktrees/` wins over the
 *  checkout that holds it — or `null`. */
export function placeOf(cwd: string, repos: readonly RepoNode[]): Place | null {
  let best: Place | null = null
  for (const r of repos)
    for (const w of r.worktrees)
      if (inside(cwd, w.path) && (!best || norm(w.path).length > norm(best.path).length))
        best = { path: w.path, name: w.name, repo: r.name }
  return best
}

/** The session on screen: the Nexus drawer's tab shown, expanded, the Nexus open. `worktree`: a
 *  dispatched child's tab's worktree, so the child resumed as a new session there is still the one
 *  on screen. */
export type Shown = { sessionId: string | null; worktree: string | null }

/** What `shownSession` reads of the Nexus store. */
export type DrawerOnScreen = {
  collapsed: boolean
  activeTab: string | null
  tabs: readonly { id: string; kind: string; sessionId: string | null; cwd: string | null }[]
}

/** The session the drawer shows, or null when it shows none: the drawer collapsed or empty. */
export function shownSession(nexus: DrawerOnScreen, repos: readonly RepoNode[]): Shown | null {
  if (nexus.collapsed) return null
  const tab = nexus.tabs.find((t) => t.id === nexus.activeTab)
  if (!tab) return null
  return { sessionId: tab.sessionId, worktree: tab.kind === 'robot' && tab.cwd ? (placeOf(tab.cwd, repos)?.path ?? null) : null }
}

/** The ship's figure for session `sessionId`: a dispatched child's robot (its short id), else the
 *  captain, whose id is the session's. A child is named by its full session id, by its short id,
 *  or by a session id its short id begins, before mnemo knows the full one. */
export function figureOf(snap: Snapshot, sessionId: string): string {
  return allChildren(snap).find((c) => c.session_id === sessionId || c.id === sessionId || sessionId.startsWith(c.id))?.id ?? sessionId
}

/** What `e` is worth telling, before asking whether you are looking: a `stop` is a finished turn,
 *  a `notification` a permission or a question. The rest — and a notification that is not an ask
 *  (the idle nudge a minute after a stop, a login notice) — is `null`. */
export function alertFor(e: AgentEvent, repos: readonly RepoNode[]): Alert | null {
  let kind: AlertKind
  if (e.kind === 'stop') kind = 'done'
  else if (e.kind === 'notification') {
    const k = notificationKind(e.message)
    if (k === 'none' || k === null) return null
    kind = k
  } else return null
  return alertOf({ sessionId: e.sessionId, cwd: e.cwd, kind, message: e.message, at: e.at }, repos)
}

/** The alert of `kind` about session `sessionId` in `cwd`, worded for the card: a finished turn by
 *  the agent's title, an ask by what it asks (`message`), else by its kind. */
export function alertOf(a: { sessionId: string; cwd: string; kind: AlertKind; message?: string | null; at: number }, repos: readonly RepoNode[]): Alert {
  const place = placeOf(a.cwd, repos)
  const title = agentTitle(a.sessionId, repos)
  const message =
    a.kind === 'done' ? (title ? `Finished: ${title}` : 'Claude finished its turn') : a.message?.trim() || (a.kind === 'permission' ? 'Claude needs your permission' : 'Claude has a question for you')
  return {
    sessionId: a.sessionId,
    kind: a.kind,
    worktree: place?.path ?? null,
    name: place?.name ?? basename(a.cwd),
    repo: place?.repo ?? null,
    message,
    at: a.at,
  }
}

/** The agent's title, unless it is only the fleet's stand-in for a session it has no name for. */
function agentTitle(sessionId: string, repos: readonly RepoNode[]): string | null {
  for (const r of repos)
    for (const w of r.worktrees)
      for (const a of w.agents) if (a.sessionId === sessionId) return a.title && a.title !== `session ${sessionId.slice(0, 8)}` ? a.title : null
  return null
}

/** What mnemo types into a session itself — a child's report card, a wake after a limit, a PR
 *  follow-up, a tree sweep's line — and what another session sends it. Claude Code frames a peer
 *  turn with a header (or the raw `<cross-session-message>` tag); mnemo's own come framed or bare. */
const PEER = /^(Another Claude session sent a message:|<cross-session-message\b)/
const MNEMO = ['<mnemo-child-finished', '<mnemo-resume', '<mnemo-pr-follow', '🧹 ']
/** What Claude Code types into a session itself when one of its own background commands or agents
 *  finishes (a `gh pr checks --watch`, a merge left running): the agent reads it on its next turn. */
const TASK = '<task-notification>'

/** A prompt no person sent: the turn it starts is not one you are waiting on. */
export function quietPrompt(message: string | undefined): boolean {
  const m = (message ?? '').trimStart()
  return PEER.test(m) || m.startsWith(TASK) || MNEMO.some((p) => m.startsWith(p))
}

/** Whose card an alert is: a dispatched child's worktree, so a resume that forks a new session
 *  there reads as the same child; any other agent, its session. */
export function cardKey(sessionId: string, worktree: string | null, repos: readonly RepoNode[]): string {
  if (worktree !== null) for (const r of repos) for (const w of r.worktrees) if (w.kind === 'dispatched' && norm(w.path) === norm(worktree)) return `tree:${norm(w.path)}`
  return `session:${sessionId}`
}

/** You are looking at the agent: the window has focus and the drawer shows its session, or the
 *  dispatched child's worktree it runs in. */
export function onScreen(alert: Pick<Alert, 'sessionId' | 'worktree'>, at: { focused: boolean; shown: Shown | null }): boolean {
  if (!at.focused || !at.shown) return false
  if (at.shown.sessionId !== null && at.shown.sessionId === alert.sessionId) return true
  return alert.worktree !== null && at.shown.worktree !== null && norm(alert.worktree) === norm(at.shown.worktree)
}


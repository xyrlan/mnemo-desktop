import type { AgentEvent } from '../agents/events'
import { notificationKind } from '../fleet/model'
import type { RepoNode } from '../fleet/types'

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

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'

/** `cwd` is `root` or inside it; `/a/bc` is not inside `/a/b`. */
export function inside(cwd: string, root: string): boolean {
  const c = norm(cwd)
  const r = norm(root)
  return c === r || c.startsWith(r === '/' ? '/' : `${r}/`)
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

/** The worktree on screen: the one the layout shows, or, before one is chosen, the first repo's
 *  main checkout (what the shell shows then). */
export function shownWorktree(active: string | null, repos: readonly RepoNode[]): string | null {
  if (active !== null) return active
  const first = repos[0]?.worktrees
  return first?.find((w) => w.kind === 'main')?.path ?? first?.[0]?.path ?? null
}

const baseName = (p: string) => norm(p).split('/').pop() || p

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
  const place = placeOf(e.cwd, repos)
  const title = agentTitle(e.sessionId, repos)
  const message =
    kind === 'done' ? (title ? `Finished: ${title}` : 'Claude finished its turn') : e.message?.trim() || (kind === 'permission' ? 'Claude needs your permission' : 'Claude has a question for you')
  return {
    sessionId: e.sessionId,
    kind,
    worktree: place?.path ?? null,
    name: place?.name ?? baseName(e.cwd),
    repo: place?.repo ?? null,
    message,
    at: e.at,
  }
}

/** The agent's title, unless it is only the fleet's stand-in for a session it has no name for. */
function agentTitle(sessionId: string, repos: readonly RepoNode[]): string | null {
  for (const r of repos)
    for (const w of r.worktrees)
      for (const a of w.agents) if (a.sessionId === sessionId) return a.title && a.title !== `session ${sessionId.slice(0, 8)}` ? a.title : null
  return null
}

/** The pane running session `sessionId`, when the fleet knows one. */
export function paneOf(sessionId: string, repos: readonly RepoNode[]): number | null {
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) if (a.sessionId === sessionId) return a.paneId
  return null
}

/** You are looking at the agent: the window has focus and shows its worktree, or one of the
 *  shown worktree's tabs holds its pane (an agent in a folder no repo owns). */
export function looking(alert: Pick<Alert, 'worktree'>, at: { focused: boolean; shown: string | null; shownPanes: readonly number[]; pane: number | null }): boolean {
  if (!at.focused) return false
  if (alert.worktree !== null && at.shown !== null && norm(alert.worktree) === norm(at.shown)) return true
  return at.pane !== null && at.shownPanes.includes(at.pane)
}

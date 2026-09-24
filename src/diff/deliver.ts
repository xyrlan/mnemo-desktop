import type { RepoNode } from '../fleet/types'
import type { ChildSession } from '../mission/types'
import type { Pane } from '../layout/store'
import { norm, within } from '../fleet/model'

/** Where a worktree's notes go: a dispatched child's inbox (its mission reply), or the terminal
 *  pane its interactive Claude runs in. `label` names it for the user. */
export type Target = { kind: 'mission'; id: string; label: string } | { kind: 'pane'; pane: number; label: string }

export type Sources = {
  repos: readonly RepoNode[]
  /** Every child the mission snapshot knows. */
  children: readonly ChildSession[]
  panes: Readonly<Record<number, Pane>>
  /** The focused pane, which wins when several Claude panes run in the tree. */
  focused?: number | null
}

/** The worktree `cwd` is in, of `trees`: the deepest that holds it, since a tree can sit inside
 *  another (`.claude/worktrees/…` in a main checkout). */
function ownerOf(cwd: string, trees: readonly string[]): string | null {
  let best: string | null = null
  for (const t of trees) if (within(cwd, t) && (best === null || t.length > best.length)) best = t
  return best
}

/** Who reads notes written in `worktree`. A dispatched tree's child answers through its mission
 *  reply, as the mission view's does; any other tree's Claude is typed to in its pane — the
 *  focused one when several run there, else the one that changed state last. None: no agent
 *  runs in the tree. */
export function findTarget(worktree: string, src: Sources): Target | null {
  const wt = norm(worktree)
  const trees = src.repos.flatMap((r) => r.worktrees.map((w) => norm(w.path)))
  if (!trees.includes(wt)) trees.push(wt)
  const mine = (cwd: string | undefined | null) => !!cwd && ownerOf(cwd, trees) === wt
  const node = src.repos.flatMap((r) => r.worktrees).find((w) => norm(w.path) === wt)

  if (node?.kind !== 'main' && node?.kind !== 'workspace') {
    const child = src.children.find((c) => c.live && mine(c.cwd))
    if (child) return { kind: 'mission', id: child.id, label: child.name || child.branch || child.id }
  }

  const running = (node?.agents ?? [])
    .filter((a) => a.paneId !== null && src.panes[a.paneId]?.view === 'terminal')
    .sort((a, b) => b.since - a.since)
  const agent = running.find((a) => a.paneId === src.focused) ?? running[0]
  if (agent?.paneId != null) return { kind: 'pane', pane: agent.paneId, label: agent.title || src.panes[agent.paneId]?.title || 'Claude' }

  // The fleet may not have matched a pane to its agent yet: a terminal opened for a session is one.
  const panes = Object.values(src.panes).filter((p) => p.view === 'terminal' && p.sessionId && mine(p.cwd))
  const pane = panes.find((p) => p.id === src.focused) ?? panes[0]
  return pane ? { kind: 'pane', pane: pane.id, label: pane.title || 'Claude' } : null
}

/** `text` as one bracketed paste: Claude Code keeps a multi-line paste as one turn, where a bare
 *  newline would be Enter. Control characters that could end the paste early are dropped. */
export function pasteOf(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  return `\x1b[200~${clean}\x1b[201~`
}

/** How long Claude Code's input takes to settle a paste before Enter submits it. */
export const ENTER_DELAY_MS = 250

export type SendDeps = {
  reply(id: string, text: string): Promise<void>
  write(pane: number, data: string): Promise<void>
  sleep?(ms: number): Promise<void>
}

/** Sends `text` to `target` as one message. Rejects with the reason when it did not go. */
export async function sendTo(target: Target, text: string, deps: SendDeps): Promise<void> {
  if (target.kind === 'mission') return deps.reply(target.id, text)
  await deps.write(target.pane, pasteOf(text))
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(ENTER_DELAY_MS)
  await deps.write(target.pane, '\r')
}

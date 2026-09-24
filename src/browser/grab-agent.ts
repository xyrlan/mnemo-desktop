import type { AgentNode, RepoNode } from '../fleet/types'
import type { ChildSession } from '../mission/types'
import { dropText } from '../terminal/drop'

/** Where Design Mode's write-up goes: the agent of the worktree on screen. A Claude session in
 *  one of its terminal panes is typed into; a dispatched child, which has no pane here, gets
 *  it as a mission reply. */
export type AgentTarget =
  | { kind: 'pane'; pane: number; title: string }
  | { kind: 'mission'; id: string; title: string }
  | { kind: 'none'; reason: string }

export type Where = {
  /** The worktree shown (`activeWorktree`), null before one is chosen. */
  worktree: string | null
  repos: RepoNode[]
  panes: Record<number, { id: number; view: string; exitCode?: number | null; error?: string }>
  children: ChildSession[]
}

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const within = (cwd: string, path: string) => {
  const c = norm(cwd)
  const p = norm(path)
  return c === p || c.startsWith(p === '/' ? p : `${p}/`)
}

/** Keys typed into a session waiting on a dialog answer the dialog (Enter picks "Yes"). */
const waiting = (a: AgentNode) => a.state === 'needs-you'

export function resolveAgent(w: Where): AgentTarget {
  if (!w.worktree) return { kind: 'none', reason: 'no worktree is open' }
  const path = norm(w.worktree)
  const node = w.repos.flatMap((r) => r.worktrees).find((t) => norm(t.path) === path)
  const name = node?.name ?? path.split('/').pop() ?? path

  const live = (id: number | null) => {
    const p = id === null ? undefined : w.panes[id]
    return !!p && p.view === 'terminal' && p.exitCode === undefined && !p.error
  }
  const inPanes = (node?.agents ?? []).filter((a) => live(a.paneId))
  const ready = inPanes.find((a) => !waiting(a))
  if (ready) return { kind: 'pane', pane: ready.paneId!, title: ready.title }

  const child = w.children.find((c) => c.live && c.state !== 'done' && c.state !== 'stopped' && within(c.cwd, path))
  if (child) return { kind: 'mission', id: child.id, title: child.name ?? child.id }

  const asking = inPanes[0]
  if (asking) {
    const what = asking.waitingFor === 'question' ? 'question' : 'permission prompt'
    return { kind: 'none', reason: `${asking.title} is waiting on a ${what}: answer it first` }
  }
  if (node?.agents.length) return { kind: 'none', reason: `${node.agents[0].title} runs outside the app's terminals` }
  return { kind: 'none', reason: `no agent is running in ${name}` }
}

/** The text as Claude Code's input takes it: one bracketed paste, so newlines stay inside the
 *  turn. Control characters other than newline and tab are dropped: page text cannot close
 *  the paste early or press keys. */
export function pasteOf(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  return `\x1b[200~${clean}\x1b[201~`
}

export type Sinks = {
  writePty(pane: number, data: string): Promise<void>
  reply(id: string, text: string): Promise<void>
  goToPane(pane: number): void
  sleep(ms: number): Promise<void>
}

/** Time for Claude Code to take one burst of input before the next. */
export const KEY_GAP_MS = 150

/** Sends `text` (and the screenshot at `shot`) to `target`. In a pane the screenshot's path goes
 *  first, typed bare as a dropped file is, which Claude Code attaches as an image; then the text
 *  as one paste, then Enter. The pane is brought on screen so the turn is seen landing. */
export async function deliver(target: AgentTarget, text: string, shot: string | null, s: Sinks): Promise<void> {
  switch (target.kind) {
    case 'none':
      throw new Error(target.reason)
    case 'mission':
      return s.reply(target.id, text)
    case 'pane': {
      if (shot) {
        await s.writePty(target.pane, dropText([shot]))
        await s.sleep(KEY_GAP_MS)
      }
      await s.writePty(target.pane, pasteOf(text))
      await s.sleep(KEY_GAP_MS)
      await s.writePty(target.pane, '\r')
      s.goToPane(target.pane)
    }
  }
}

// adapted from stablyai/orca lib/fix-checks-agent-launch.ts: an existing agent in the worktree
// gets the prompt; with none, one is started there and gets it once it is up
import { deliver, resolveAgent, type AgentTarget, type Sinks, type Where } from '../browser/grab-agent'

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const within = (cwd: string, path: string) => {
  const c = norm(cwd)
  const p = norm(path)
  return c === p || c.startsWith(p === '/' ? p : `${p}/`)
}

/** Nothing runs in the worktree at all: no session the fleet knows of, no dispatched child. Only
 *  then is a new agent started; one waiting on a prompt, or running outside the app's terminals,
 *  is left alone and its reason shown. */
export function noAgent(w: Where): boolean {
  if (!w.worktree) return false
  const path = norm(w.worktree)
  const node = w.repos.flatMap((r) => r.worktrees).find((t) => norm(t.path) === path)
  if (node?.agents.length) return false
  return !w.children.some((c) => c.live && c.state !== 'done' && c.state !== 'stopped' && within(c.cwd, path))
}

/** Where a send from the Checks tab would go now, as its buttons say it. */
export type Destination = { kind: 'agent'; target: Exclude<AgentTarget, { kind: 'none' }> } | { kind: 'start' } | { kind: 'none'; reason: string }

export function destinationOf(w: Where): Destination {
  const target = resolveAgent(w)
  if (target.kind !== 'none') return { kind: 'agent', target }
  return noAgent(w) ? { kind: 'start' } : { kind: 'none', reason: target.reason }
}

export type AgentDeps = {
  /** Design Mode's view of the app, for `worktree`. */
  where(worktree: string): Where
  sinks: Sinks
  /** Opens a terminal tab in `worktree` running `claude`. */
  start(worktree: string): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
}

/** How long a started `claude` has to come up (a first-run dialog may wait on the user). */
export const START_TIMEOUT_MS = 90_000
const LOOK_MS = 1_000

export type Sent = { title: string; started: boolean }

/** Sends `text` to `worktree`'s agent through Design Mode's routing and guard (nothing is typed
 *  unless the pane still runs Claude). With no agent there, starts one and sends once the fleet
 *  sees it ready in a pane. `onStarting` is called when that wait begins. */
export async function sendToAgent(worktree: string, text: string, deps: AgentDeps, onStarting?: () => void): Promise<Sent> {
  const first = destinationOf(deps.where(worktree))
  if (first.kind === 'none') throw new Error(first.reason)
  if (first.kind === 'agent') {
    await deliver(first.target, text, null, deps.sinks)
    return { title: first.target.title, started: false }
  }
  onStarting?.()
  await deps.start(worktree)
  const until = deps.now() + START_TIMEOUT_MS
  for (;;) {
    const target = resolveAgent(deps.where(worktree))
    if (target.kind !== 'none') {
      await deliver(target, text, null, deps.sinks)
      return { title: target.title, started: true }
    }
    if (deps.now() >= until) throw new Error(`Claude did not come up in the new terminal within ${START_TIMEOUT_MS / 1000} s: nothing was sent`)
    await deps.sleep(LOOK_MS)
  }
}

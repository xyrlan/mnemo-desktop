import { listen } from '@tauri-apps/api/event'

/** Emitted by `src-tauri/src/agent_hooks.rs` for each Claude Code hook the app hears. */
export const AGENT_EVENT = 'agent://event'

/**
 * One moment in a Claude Code session, the instant it happens: it `start`ed, got a `prompt`,
 * `stop`ped (its turn is done), sent a `notification` (it is waiting on you: a permission
 * prompt, or idle at the prompt) or `end`ed.
 *
 * `message` is the notification's text ("Claude needs your permission to use Bash"), or the
 * prompt cut to 200 characters; other kinds carry none. `at` is milliseconds since the epoch,
 * stamped by the hook when the event fired.
 */
export type AgentEvent = {
  sessionId: string
  cwd: string
  kind: 'start' | 'prompt' | 'stop' | 'notification' | 'end'
  message?: string
  at: number
}

const KINDS: ReadonlySet<string> = new Set(['start', 'prompt', 'stop', 'notification', 'end'])

/** The payload as an `AgentEvent`, or `null` when it is not one. */
export function parseAgentEvent(p: unknown): AgentEvent | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  if (typeof o.sessionId !== 'string' || !o.sessionId) return null
  if (typeof o.cwd !== 'string' || typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  const e: AgentEvent = { sessionId: o.sessionId, cwd: o.cwd, kind: o.kind as AgentEvent['kind'], at: o.at }
  if (typeof o.message === 'string') e.message = o.message
  return e
}

/**
 * Calls `cb` for every agent event from now on; the returned function stops it. Events are
 * live only: what happened before (or while the app was closed) is not replayed, which is
 * what the `claude agents` polling reconciles.
 */
export function subscribeAgentEvents(cb: (e: AgentEvent) => void): () => void {
  let stopped = false
  let unlisten: (() => void) | undefined
  listen<unknown>(AGENT_EVENT, (msg) => {
    if (stopped) return
    const e = parseAgentEvent(msg.payload)
    if (e) cb(e)
  }).then(
    (u) => {
      if (stopped) u()
      else unlisten = u
    },
    (err) => console.warn('agent events: not listening', err),
  )
  return () => {
    if (stopped) return
    stopped = true
    unlisten?.()
  }
}

/** Jarvis's parents (#505, decisions 3, 5 and 6): a Claude Code or Grok session the desktop opens
 *  in a project for a request that writes, the handoff typed into it, and following it until it
 *  is done. The panel calls only `ParentsApi`.
 *
 *  This file is the seam's placeholder: the `jarvis-parent` piece of
 *  `docs/superpowers/contracts/2026-10-23-jarvis-wave-b.md` replaces its body and keeps these
 *  signatures. */

export type Host = 'claude' | 'grok'

/** A parent Jarvis opened. `sessionId` is the one passed to `--session-id`. */
export type ParentRef = { sessionId: string; project: string; root: string; request: string; host: Host; startedAt: number }

export type ParentState = 'starting' | 'working' | 'idle' | 'asking' | 'approval' | 'exited'

export type ParentStatus = {
  state: ParentState
  /** One sentence on the parent's last message, once a turn has ended. */
  summary: string | null
  /** What it asks, while `state` is `asking` or `approval`. */
  question: string | null
}

export type ParentEvent =
  | { kind: 'opened'; parent: ParentRef }
  | { kind: 'turn-ended'; parent: ParentRef; summary: string }
  | { kind: 'asking'; parent: ParentRef; question: string }
  | { kind: 'approval'; parent: ParentRef; question: string }
  | { kind: 'exited'; parent: ParentRef }

export type OpenParent = {
  project: string
  root: string
  /** The maintainer's words, verbatim. */
  request: string
  /** What Jarvis gathered (git state, files read, what the screen showed, in words), handed over
   *  as "gathered by Jarvis, may be wrong". */
  gathered: string
  /** The config's default host when absent. */
  host?: Host
}

export interface ParentsApi {
  /** Opens a session in `root` the way *New session* does, never with
   *  `--dangerously-skip-permissions` whatever the setting says, and types the three-part handoff
   *  into it once its prompt is up. */
  open(o: OpenParent): Promise<ParentRef>
  /** Types a follow-up into a running parent. */
  send(sessionId: string, text: string): Promise<void>
  status(sessionId: string): Promise<ParentStatus>
  /** Answers the permission prompt the parent is waiting on. */
  answer(sessionId: string, allow: boolean): Promise<void>
  /** Stops the parent ("cancela"). */
  cancel(sessionId: string): Promise<void>
  /** The parents opened in this run of the app and not exited, newest first. */
  running(): ParentRef[]
  subscribe(cb: (e: ParentEvent) => void): () => void
}

const missing = () => Promise.reject(new Error('jarvis: parents arrive with the jarvis-parent piece'))

export function createParents(): ParentsApi {
  return {
    open: missing,
    send: missing,
    status: missing,
    answer: missing,
    cancel: missing,
    running: () => [],
    subscribe: () => () => {},
  }
}

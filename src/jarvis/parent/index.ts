/** Jarvis's parents (#505, decisions 3, 5 and 6): a Claude Code or Grok session the desktop opens
 *  in a project for a request that writes, the handoff typed into it, and following it until it
 *  is done. The panel calls only `ParentsApi`.
 *
 *  - `./handoff`: the three-part text typed into a parent;
 *  - `./follow`: its state, from its `claude agents` row and its transcript (pure);
 *  - `./parents`: the API over what it needs of the app; `./live`, that, as the app runs it. */

import { makeParents } from './parents'

export { conversation, followUp, handoff } from './handoff'

export type Host = 'claude' | 'grok'

/** A parent Jarvis opened. `sessionId` is the one passed to `--session-id`; `request` is what it
 *  was asked to do: the brain's task when it wrote one, else the maintainer's words. */
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
  /** The task as the brain wrote it from the conversation, self-contained; empty when it wrote
   *  none of its own. */
  task: string
  /** The exchanges that led to the request, as `conversation` writes them; empty when none. */
  conversation: string
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

/** The app's parents. Nothing of the app loads until a call needs it: the types and a fresh
 *  `running()` cost nothing. */
export function createParents(): ParentsApi {
  return makeParents(() => import('./live').then((m) => m.liveDeps))
}

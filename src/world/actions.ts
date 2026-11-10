// Everything a view can do to the fleet. Views call these and nothing else; `src/runtime/`
// implements them over the paths the app already has, with every guard those paths carry.
// In the sample world they change the sample and nothing else (`src/world/sample.ts`).

/** What came of an action. A refusal is an answer, not an exception: `why` is said to the
 *  maintainer as it is. */
export type Outcome = { ok: true; note?: string } | { ok: false; why: string }

export interface DispatchOptions {
  model?: string
  effort?: string
  /** push | pr | none */
  may?: string
  advisor?: string
}

export interface Actions {
  /** Make the session's terminal ready for the stage: host it, attach to it, or resume it. A
   *  session that cannot be opened here says why (it runs in another terminal, say). */
  open(sessionId: string): Promise<Outcome>
  /** Answer a waiting item with one of its choices (`Choice.key`). */
  answer(pendingId: string, key: number): Promise<Outcome>
  /** Answer a waiting item, or speak to a session, in the maintainer's own words. */
  reply(sessionId: string, text: string): Promise<Outcome>
  stop(sessionId: string): Promise<Outcome>
  /** End a session the app hosts and forget its terminal. */
  close(sessionId: string): Promise<Outcome>
  newSession(root: string, options?: { prompt?: string; agent?: string }): Promise<Outcome>
  newShell(root: string): Promise<Outcome>
  dispatch(root: string, issues: number[], options?: DispatchOptions): Promise<Outcome>
  dispatchContract(root: string, path: string, options?: DispatchOptions): Promise<Outcome>
  /** A message to a child's inbox, which can never approve anything. `all`: every live child. */
  message(sessionId: string | 'all', text: string): Promise<Outcome>
  /** Merge every pull request that is open, mergeable and green. */
  mergeGreen(): Promise<Outcome>
  land(root: string, feature: string): Promise<Outcome>
  /** A screenshot a session took, as a URL an <img> can show; null when it is gone. */
  shot(sessionId: string, shotId: string): Promise<string | null>
  /** Open a link or a file outside the app. */
  external(target: string): Promise<Outcome>
}

const NOT_YET: Outcome = { ok: false, why: 'This build cannot do that yet.' }
const refuse = async (): Promise<Outcome> => NOT_YET

/** What answers before a runtime is set: every action refuses, in words. */
export const NO_ACTIONS: Actions = {
  open: refuse,
  answer: refuse,
  reply: refuse,
  stop: refuse,
  close: refuse,
  newSession: refuse,
  newShell: refuse,
  dispatch: refuse,
  dispatchContract: refuse,
  message: refuse,
  mergeGreen: refuse,
  land: refuse,
  shot: async () => null,
  external: refuse,
}

let current: Actions = NO_ACTIONS

/** The runtime, or the sample world, sets what acts. Returns how to put the last one back. */
export function setActions(next: Actions): () => void {
  const before = current
  current = next
  return () => {
    current = before
  }
}

/** The actions in force. Read at the moment of acting, never kept. */
export const actions = (): Actions => current

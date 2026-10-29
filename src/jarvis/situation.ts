import type { JarvisClient } from './client'

/** The state of the projects, kept fresh in the background so the brain answers "como tá tudo?"
 *  with no tool call (jarvis-situation, #503): what runs (sessions, the children mnemo dispatched),
 *  what waits (open PRs and their CI, open issues), of every known project, read through the read
 *  tools `jarvis_tool` already runs. The loop hands `text` to the brain with a request when it
 *  changed since the brain last saw it.
 *
 *  The seam's situation knows nothing: `text` stays ''. */

export type Situation = {
  /** The panorama in a few short lines, for the brain; '' until a refresh has read something. */
  text(): string
  /** When `text` last changed, ms since the epoch; null while it is ''. */
  changedAt(): number | null
  /** Reads it all again now; resolves once `text` is current. Never rejects. */
  refresh(): Promise<void>
  /** Keeps it fresh from now on; the function returned stops that. */
  start(): () => void
}

export function createSituation(client: JarvisClient, now: () => number): Situation {
  void client
  void now
  return { text: () => '', changedAt: () => null, refresh: async () => {}, start: () => () => {} }
}

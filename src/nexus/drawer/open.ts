import type { Agent } from '../../agent/active'
import type { PaneId } from '../../layout/tree'
import { liveSessions } from './app'

/** A session the drawer starts (spec `2026-10-15-nexus-app-design.md`, Q1, Q4): `claude` in a repo,
 *  or `claude --resume <id>`; a plain shell; a saved command. Each runs in a pane with no view on
 *  screen (the layout store stays the session registry) and opens in a drawer tab. `claude` is the
 *  agent CLI, whichever kind: `agent`, given with `resume`, is the account the session itself runs
 *  on, so it resumes there (spec `2026-10-16-grok-accounts-design.md`, decision 6); without it, the
 *  account a pane of the app ran it on, else the active one.
 *
 *  A new session Jarvis opens as a parent (#505, decision 3) names the rest: `sessionId`, the id it
 *  starts under, which the caller follows; `agent`, the account it runs on (the active one when
 *  absent); and `ask`, set, never skips its permission prompts, whatever Settings say: they are the
 *  only guard between a misheard sentence and a write. */
export type SessionSpec =
  | { kind: 'claude'; root: string; resume?: string; agent?: Agent; sessionId?: string; ask?: boolean }
  | { kind: 'shell'; root: string }
  | { kind: 'command'; root: string; command: string; label: string }

/** Starts the session and opens it in a drawer tab showing its live terminal, the Nexus open
 *  (`./start`). `claude` is typed as *Launch agent* types it, under a session id of its own, so its
 *  tab is its captain's; a session one of the app's panes runs already is shown instead. A command
 *  is typed once the prompt is up. What could not start rejects, saying why, and nothing is opened:
 *  the caller says it. */
export async function openSession(spec: SessionSpec): Promise<void> {
  return liveSessions.openSession(spec)
}

/** The pane the app runs Claude session `sessionId` in, or null when it runs outside the app (a
 *  captain's **Close** ends only a session the app holds, Q2). */
export function paneOf(sessionId: string): PaneId | null {
  return liveSessions.paneOf(sessionId)
}

/** Ends the session in pane `pane`: its terminal closes and its drawer tab goes. */
export async function endSession(pane: PaneId): Promise<void> {
  return liveSessions.endSession(pane)
}

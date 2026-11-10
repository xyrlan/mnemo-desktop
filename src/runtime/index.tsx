// The runtime: what makes the new front act on real sessions. It hosts terminals, implements
// `Actions` over the paths the app already has, and starts what the ship's view used to start
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "What stays of the core and the
// front"). A placeholder until the piece lands: nothing is hosted and nothing is started.

import type { Session } from '../world/types'

/** Whether the stage can show this session's terminal live, here and now. */
export function canHost(session: Session): boolean {
  void session
  return false
}

/** The session's real terminal. `active`: it is the one on stage and takes the keys. Only
 *  rendered for a session `canHost` accepts. */
export function LiveTerminal({ sessionId, active }: { sessionId: string; active: boolean }) {
  return <div data-live-terminal={sessionId} data-active={active || undefined} />
}

/** Start the runtime in a live world: set the real `Actions`, restore the hosted sessions,
 *  keep the tab state the desktop MCP, dictation and notifications read. Returns how to stop. */
export function startRuntime(): () => void {
  return () => {}
}

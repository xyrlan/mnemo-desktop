import { toast } from '@/ui'
import type { PaneId } from '../../layout/tree'

/** A session the drawer starts (spec `2026-10-15-nexus-app-design.md`, Q1, Q4): `claude` in a repo,
 *  or `claude --resume <id>`; a plain shell; a saved command. Each runs in a pane with no view on
 *  screen (the layout store stays the session registry) and opens in a drawer tab. */
export type SessionSpec =
  | { kind: 'claude'; root: string; resume?: string }
  | { kind: 'shell'; root: string }
  | { kind: 'command'; root: string; command: string; label: string }

/** Starts the session and opens it in the drawer. Stub until the round's `sessions` piece lands. */
export async function openSession(spec: SessionSpec): Promise<void> {
  toast(`Opening a ${spec.kind} session is not built yet`)
}

/** The pane the app runs Claude session `sessionId` in, or null when it runs outside the app (a
 *  captain's **Close** ends only a session the app holds, Q2). Stub until `sessions` lands. */
export function paneOf(sessionId: string): PaneId | null {
  void sessionId
  return null
}

/** Ends the session in pane `pane`: its terminal closes and its drawer tab goes. Stub until
 *  `sessions` lands. */
export async function endSession(pane: PaneId): Promise<void> {
  toast(`Ending the session in pane ${pane} is not built yet`)
}

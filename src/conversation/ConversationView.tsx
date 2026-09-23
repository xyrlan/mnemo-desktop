import type { ReactNode } from 'react'
import type { ConversationClient } from './client'
import type { SessionStatus, StatusMarker } from './types'

export type ConversationViewProps = {
  /** The session to follow. When it changes (a `/clear` in the pane), what was shown stays above
   *  a `── /clear ──` divider and the new session continues below. `null`: no session yet. */
  sessionId: string | null
  /** Where the session runs; the transcript lives under this cwd's project dir. */
  cwd: string
  /** From `claude agents` / the mission snapshot: drives the `working… 0:42` row and the pending
   *  card (a tool call with no result while `waiting` is set). */
  status?: SessionStatus
  /** Thin lines merged into the stream by time (a child's status transitions). */
  markers?: StatusMarker[]
  /** Pinned under the stream (a child's Approve / Deny / reply box). */
  footer?: ReactNode
  /** The pending card's button: a pane flips to its terminal face, a child opens `claude attach`. */
  onOpenTerminal?: () => void
  client?: ConversationClient
}

/** A Claude Code session's transcript as cards.
 *
 *  Round 20 seam: the `view` piece writes this body (docs/contracts/round20.md). */
export function ConversationView({ sessionId }: ConversationViewProps) {
  return <div className="conversation">{sessionId ? `conversation ${sessionId}` : 'no Claude session in this pane yet'}</div>
}

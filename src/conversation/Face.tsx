import type { PaneId } from '../layout/tree'

/** The conversation face of terminal pane `paneId`: laid over the xterm, which stays mounted and
 *  sized underneath so the PTY and the TUI never notice the face changed.
 *
 *  Round 20 seam: the `view` piece writes this body (docs/contracts/round20.md). */
export default function ConversationFace({ paneId }: { paneId: PaneId }) {
  return (
    <div className="conversation-face" data-pane={paneId} style={{ position: 'absolute', inset: 0, background: 'var(--bg)', overflow: 'auto' }}>
      conversation
    </div>
  )
}

import { useCallback, useMemo, useRef } from 'react'
import type { PaneId } from '../layout/tree'
import { store, useApp } from '../layout/app-store'
import { useMission } from '../mission/app-store'
import type { Snapshot } from '../mission/types'
import type { SessionStatus } from './types'
import { ConversationView } from './ConversationView'
import './usage'

/** What `claude agents` says of `sessionId`, through the mission snapshot's parents. Waiting is
 *  reported as `permission`; the view reads an AskUserQuestion pending card as a question. */
export function paneStatus(snap: Snapshot, sessionId: string | undefined): SessionStatus | undefined {
  if (!sessionId) return undefined
  const p = snap.repos.flatMap((r) => r.parents).find((x) => x.session_id === sessionId)
  if (!p) return undefined
  return { busy: p.status === 'busy', waiting: /wait|permission|input|approv/i.test(p.status) ? 'permission' : null }
}

/** The conversation face of terminal pane `paneId`: laid over the xterm, which stays mounted and
 *  sized underneath so the PTY and the TUI never notice the face changed. */
export default function ConversationFace({ paneId }: { paneId: PaneId }) {
  const ref = useRef<HTMLDivElement>(null)
  const sessionId = useApp((s) => s.panes[paneId]?.sessionId)
  const cwd = useApp((s) => s.panes[paneId]?.cwd) ?? ''
  const snap = useMission((s) => s.snapshot)
  const found = paneStatus(snap, sessionId)
  // A snapshot every 3 s must not re-derive the stream when nothing about this session moved.
  const known = found !== undefined
  const busy = !!found?.busy
  const waiting = found?.waiting ?? null
  const status = useMemo(() => (known ? { busy, waiting } : undefined), [known, busy, waiting])

  const openTerminal = useCallback(() => {
    // Read before the flip unmounts this face; the xterm under it is what takes the keys.
    const xterm = ref.current?.closest('.pane-body')?.querySelector<HTMLElement>('.xterm-helper-textarea')
    store.getState().setFace(paneId, 'terminal')
    store.getState().focusPane(paneId)
    xterm?.focus()
  }, [paneId])

  return (
    <div ref={ref} className="conversation-face" data-pane={paneId}>
      {sessionId ? (
        <ConversationView sessionId={sessionId} cwd={cwd} status={status} onOpenTerminal={openTerminal} />
      ) : (
        <div className="cv-empty">
          <div>no Claude session in this pane</div>
          <div className="cv-muted">
            start <code>claude</code> in it, or press <kbd>⌘⇧C</kbd> to go back to the terminal
          </div>
        </div>
      )}
    </div>
  )
}

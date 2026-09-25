import { useCallback, useMemo, useRef } from 'react'
import type { PaneId } from '../layout/tree'
import { store, useApp } from '../layout/app-store'
import { useMission } from '../mission/app-store'
import type { Snapshot } from '../mission/types'
import type { SessionStatus } from './types'
import { ConversationView, EmptyState } from './ConversationView'
import { paneAgent, tauriPaneSinks, type PaneSinks } from './agent'
import './usage'

/** A `claude agents` session's `status` and `waitingFor` as the view's waiting kinds. Claude Code
 *  (2.1.281) says `input needed` for an AskUserQuestion (and an MCP server asking for input),
 *  `permission prompt` for a tool's permission (a plan approval too), `sandbox request` for a
 *  sandboxed command's network access. `dialog open` (`/config`…) and `goal proposal` park the
 *  session on nothing in the transcript, so no card is marked. A snapshot from before `waitingFor`
 *  was carried reads as a permission, as it did then. */
export function waitingKind(status: string, waitingFor: string | null | undefined): SessionStatus['waiting'] {
  if (status !== 'waiting') return null
  if (waitingFor == null) return 'permission'
  if (waitingFor === 'input needed') return 'question'
  if (waitingFor === 'permission prompt' || waitingFor === 'sandbox request') return 'permission'
  return null
}

/** What `claude agents` says of `sessionId`, through the mission snapshot's parents. */
export function paneStatus(snap: Snapshot, sessionId: string | undefined): SessionStatus | undefined {
  if (!sessionId) return undefined
  const p = snap.repos.flatMap((r) => r.parents).find((x) => x.session_id === sessionId)
  if (!p) return undefined
  const waiting = waitingKind(p.status, p.waiting_for)
  return { busy: p.status === 'busy', waiting, parked: p.status === 'waiting' && waiting === null }
}

/** The conversation face of terminal pane `paneId`: laid over the xterm, which stays mounted and
 *  sized underneath so the PTY and the TUI never notice the face changed. What the chat's foot
 *  sends is typed into that PTY, and only while it still runs Claude (`paneAgent`). */
export default function ConversationFace({ paneId, sinks = tauriPaneSinks }: { paneId: PaneId; sinks?: PaneSinks }) {
  const ref = useRef<HTMLDivElement>(null)
  const sessionId = useApp((s) => s.panes[paneId]?.sessionId)
  const cwd = useApp((s) => s.panes[paneId]?.cwd) ?? ''
  const snap = useMission((s) => s.snapshot)
  const found = paneStatus(snap, sessionId)
  // A snapshot every 3 s must not re-derive the stream when nothing about this session moved.
  const known = found !== undefined
  const busy = !!found?.busy
  const waiting = found?.waiting ?? null
  const parked = !!found?.parked
  const status = useMemo(() => (known ? { busy, waiting, parked } : undefined), [known, busy, waiting, parked])
  const agent = useMemo(() => paneAgent(paneId, sinks), [paneId, sinks])

  const openTerminal = useCallback(() => {
    // Read before the flip unmounts this face; the xterm under it is what takes the keys.
    const xterm = ref.current?.closest('.pane-body')?.querySelector<HTMLElement>('.xterm-helper-textarea')
    store.getState().setFace(paneId, 'terminal')
    store.getState().focusPane(paneId)
    xterm?.focus()
  }, [paneId])

  return (
    <div ref={ref} className="conversation-face" data-ui data-pane={paneId}>
      {sessionId ? (
        <ConversationView sessionId={sessionId} cwd={cwd} status={status} onOpenTerminal={openTerminal} agent={agent} />
      ) : (
        <EmptyState
          title="No Claude session in this pane"
          subtitle={
            <>
              Start <code className="font-mono text-foreground">claude</code> in it, or press <kbd className="font-mono text-foreground">⌘⇧C</kbd> to go back to the terminal.
            </>
          }
        >
          <button type="button" className="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-accent" onClick={openTerminal}>
            Back to the terminal
          </button>
        </EmptyState>
      )}
    </div>
  )
}

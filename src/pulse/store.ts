import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PaneId } from '../layout/tree'
import type { PulseEvent } from './types'

/** An event as the app received it. `received` (not the row's `at`, which another
 *  machine's clock or a slow hook may skew) times the flashes. `pane` is the one pane it
 *  belongs to, decided once on arrival (see `routePulse`); none when no pane claimed it. */
export type Pulse = { id: number; event: PulseEvent; received: number; pane?: PaneId }

/** What a mounted pane bar shows: its repo name, the Claude session its terminal runs, and
 *  whether it is the focused pane of the active tab. */
export type Claim = { pane: PaneId; place?: string; sessionId?: string; focused?: boolean }

export type PulseState = {
  /** Oldest first, the last `MAX_PULSES`. */
  log: Pulse[]
  /** Events per pane. Never trimmed. */
  counts: Record<PaneId, number>
  /** Mounted panes, in the order they first claimed. */
  claims: Claim[]
}

export type PulseActions = {
  push(event: PulseEvent, now?: number): void
  /** Registers (or updates in place) what pane `claim.pane` shows. */
  claim(claim: Claim): void
  release(pane: PaneId): void
  /** Events of `pane`, newest first; within `withinMs` of `now` when given. */
  recentFor(pane: PaneId, withinMs?: number, now?: number): PulseEvent[]
  /** The newest pulse of `pane`: the same object until another one arrives. */
  latestFor(pane: PaneId): Pulse | undefined
  countFor(pane: PaneId): number
}

export type PulseStore = StoreApi<PulseState & PulseActions>

export const MAX_PULSES = 200

/** `project` is the pane's repo name; empty names nothing. */
export const pulseMatches = (e: PulseEvent, project: string | undefined) => !!project && (e.project === project || e.agent === project)

/** The one pane an event plays in. A session names its pane outright. Otherwise (half the
 *  logs carry no session, and a pane may not have learnt its session yet) the repo decides,
 *  among panes that could have caused it — a pane known to run another session could not
 *  have caused a session's event — preferring the focused pane, else the one that has shown
 *  the repo longest. One pane, never all of them: N panes on a repo must not play N scenes. */
export function routePulse(e: PulseEvent, claims: Claim[]): PaneId | undefined {
  if (e.session_id) {
    const own = claims.find((c) => c.sessionId === e.session_id)
    if (own) return own.pane
  }
  const here = claims.filter((c) => pulseMatches(e, c.place) && !(e.session_id && c.sessionId))
  return (here.find((c) => c.focused) ?? here[0])?.pane
}

export function createPulseStore(): PulseStore {
  let nextId = 1
  return createZustand<PulseState & PulseActions>((set, get) => ({
    log: [],
    counts: {},
    claims: [],

    push(event, now = Date.now()) {
      const pane = routePulse(event, get().claims)
      const pulse: Pulse = { id: nextId++, event, received: now, pane }
      set((s) => ({
        log: [...s.log, pulse].slice(-MAX_PULSES),
        counts: pane === undefined ? s.counts : { ...s.counts, [pane]: (s.counts[pane] ?? 0) + 1 },
      }))
    },

    claim(claim) {
      set((s) => {
        const at = s.claims.findIndex((c) => c.pane === claim.pane)
        return { claims: at < 0 ? [...s.claims, claim] : s.claims.map((c, i) => (i === at ? claim : c)) }
      })
    },

    release(pane) {
      set((s) => ({ claims: s.claims.filter((c) => c.pane !== pane) }))
    },

    recentFor(pane, withinMs, now = Date.now()) {
      const out: PulseEvent[] = []
      for (let i = get().log.length - 1; i >= 0; i--) {
        const p = get().log[i]
        if (withinMs !== undefined && now - p.received > withinMs) break
        if (p.pane === pane) out.push(p.event)
      }
      return out
    },

    latestFor(pane) {
      const log = get().log
      for (let i = log.length - 1; i >= 0; i--) if (log[i].pane === pane) return log[i]
      return undefined
    },

    countFor(pane) {
      return get().counts[pane] ?? 0
    },
  }))
}

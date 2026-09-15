import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { PulseEvent } from './types'

/** An event as the app received it. `received` (not the row's `at`, which another
 *  machine's clock or a slow hook may skew) times the flashes. */
export type Pulse = { id: number; event: PulseEvent; received: number }

export type PulseState = {
  /** Oldest first, the last `MAX_PULSES`. */
  log: Pulse[]
  /** Events per project (an event whose agent differs counts for both). Never trimmed. */
  counts: Record<string, number>
}

export type PulseActions = {
  push(event: PulseEvent, now?: number): void
  /** Events of `project` (by project or agent), newest first; within `withinMs` of `now` when given. */
  recentFor(project: string, withinMs?: number, now?: number): PulseEvent[]
  /** The newest pulse of `project`: the same object until another one arrives. */
  latestFor(project: string): Pulse | undefined
  countFor(project: string): number
}

export type PulseStore = StoreApi<PulseState & PulseActions>

export const MAX_PULSES = 200

/** `project` is the pane's repo name; empty names nothing. */
export const pulseMatches = (e: PulseEvent, project: string | undefined) => !!project && (e.project === project || e.agent === project)

export function createPulseStore(): PulseStore {
  let nextId = 1
  return createZustand<PulseState & PulseActions>((set, get) => ({
    log: [],
    counts: {},

    push(event, now = Date.now()) {
      const pulse = { id: nextId++, event, received: now }
      const keys = [...new Set([event.project, event.agent].filter(Boolean))]
      set((s) => ({
        log: [...s.log, pulse].slice(-MAX_PULSES),
        counts: keys.length ? { ...s.counts, ...Object.fromEntries(keys.map((k) => [k, (s.counts[k] ?? 0) + 1])) } : s.counts,
      }))
    },

    recentFor(project, withinMs, now = Date.now()) {
      const out: PulseEvent[] = []
      for (let i = get().log.length - 1; i >= 0; i--) {
        const p = get().log[i]
        if (withinMs !== undefined && now - p.received > withinMs) break
        if (pulseMatches(p.event, project)) out.push(p.event)
      }
      return out
    },

    latestFor(project) {
      const log = get().log
      for (let i = log.length - 1; i >= 0; i--) if (pulseMatches(log[i].event, project)) return log[i]
      return undefined
    },

    countFor(project) {
      return get().counts[project] ?? 0
    },
  }))
}

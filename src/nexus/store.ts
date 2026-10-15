import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LogEvent } from './ship-types'

/** How many milestones the ship's log keeps while the app runs (it is not persisted). */
export const LOG_MAX = 500

export type NexusState = {
  /** The app opens on the Nexus (v2 spec, "Where it sits in the app"); ⌘0 and the sidebar's
   *  Nexus entry flip it. */
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
  /** Robots shift+clicked, by id. */
  selection: ReadonlySet<string>
  toggleSelect(id: string): void
  clearSelection(): void
  triage: boolean
  setTriage(open: boolean): void
  /** The ship's log, oldest first, at most `LOG_MAX`; an event already logged (same `id`) is skipped. */
  log: LogEvent[]
  appendLog(events: LogEvent[]): void
  /** The session the drawer shows; its figure is highlighted. */
  focusId: string | null
  setFocus(id: string | null): void
}

export const nexusStore: StoreApi<NexusState> = createStore<NexusState>((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  selection: new Set(),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selection)
      if (!next.delete(id)) next.add(id)
      return { selection: next }
    }),
  clearSelection: () => set({ selection: new Set() }),
  triage: false,
  setTriage: (triage) => set({ triage }),
  log: [],
  appendLog: (events) =>
    set((s) => {
      if (!events.length) return s
      const seen = new Set(s.log.map((e) => e.id))
      const fresh = events.filter((e) => !seen.has(e.id) && seen.add(e.id))
      return fresh.length ? { log: [...s.log, ...fresh].slice(-LOG_MAX) } : s
    }),
  focusId: null,
  setFocus: (focusId) => set({ focusId }),
}))

export const useNexus = <T,>(sel: (s: NexusState) => T): T => useStore(nexusStore, sel)

import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** When each tab was last on screen, epoch ms. A tab never shown counts as seen when the app
 *  started: an agent that finished before launch is not news. */
export type Seen = { at: Record<string, number>; since: number; mark(ids: string[], now?: number): void }

export function createSeen(since = Date.now()) {
  return createStore<Seen>((set) => ({
    at: {},
    since,
    mark(ids, now = Date.now()) {
      const live = ids.filter(Boolean)
      if (live.length) set((s) => ({ at: { ...s.at, ...Object.fromEntries(live.map((id) => [id, now])) } }))
    },
  }))
}

export const seenStore = createSeen()
export const useSeen = <T,>(sel: (s: Seen) => T) => useStore(seenStore, sel)
export const seenAt = (s: Seen, id: string) => s.at[id] ?? s.since

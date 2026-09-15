import { useStore } from 'zustand'
import { createPulseStore, type PulseActions, type PulseState } from './store'
import type { PulseClient } from './client'

/** The single live store; `view.tsx` connects it to `mnemo://pulse`. Kept out of store.ts
 *  so tests of the store never import Tauri. */
export const pulseStore = createPulseStore()

type S = PulseState & PulseActions
export function usePulse(): S
export function usePulse<T>(sel: (s: S) => T): T
export function usePulse<T>(sel?: (s: S) => T) {
  return useStore(pulseStore, sel ?? ((s: S) => s as unknown as T))
}

/** Events of `project` (matched by project or agent), newest first. */
export const recentFor = (project: string, withinMs?: number) => pulseStore.getState().recentFor(project, withinMs)

/** Feeds the store from `client`; resolves to a disconnect. */
export function connectPulse(client: PulseClient, store = pulseStore): Promise<() => void> {
  return client.connect((e) => store.getState().push(e))
}

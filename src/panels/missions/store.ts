// What the Missions panel launched, kept while the app runs: closing the panel, or changing
// view, loses none of it. The ship's window kept this in its own state and forgot it when it
// closed. A launch is an action asked of `actions()`: its answer is kept beside it, and how the
// work itself is going is read from the mission snapshot when it is drawn (`./model`).

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DispatchOptions, Outcome } from '../../world/actions'

export type LaunchKind = 'issues' | 'contract' | 'land'

export interface Launch {
  id: number
  kind: LaunchKind
  root: string
  /** The repo's name, as it was when launched. */
  repo: string
  /** `issues`: the issues dispatched, ascending. */
  issues: number[]
  /** `contract`: its repo-relative path. */
  path: string | null
  /** `land`: the mission's feature. */
  feature: string | null
  options: DispatchOptions
  at: number
  /** What the action answered; null while it has not. */
  outcome: Outcome | null
}

/** The flags the next dispatch carries; empty leaves a flag off. */
export interface Flags {
  model: string
  effort: string
  may: string
  advisor: string
}
export const NO_FLAGS: Flags = { model: '', effort: '', may: '', advisor: '' }

export const optionsOf = (f: Flags): DispatchOptions => ({ model: f.model || undefined, effort: f.effort || undefined, may: f.may || undefined, advisor: f.advisor || undefined })

/** The launches kept: the newest, so the list stays a glance. */
export const KEPT = 12

export interface LaunchState {
  /** Newest first. */
  launches: Launch[]
  /** The flags as last set, so the next dispatch starts from them. */
  flags: Flags
  setFlags(flags: Flags): void
  /** Records a launch and runs it; resolves with what the action answered. An action that
   *  throws is a refusal with its message. */
  launch(what: Omit<Launch, 'id' | 'at' | 'outcome'>, act: () => Promise<Outcome>): Promise<Outcome>
  forget(id: number): void
}

export type LaunchStore = StoreApi<LaunchState>

export function createLaunchStore(now: () => number = Date.now): LaunchStore {
  let seq = 0
  return createStore<LaunchState>((set, get) => ({
    launches: [],
    flags: NO_FLAGS,
    setFlags: (flags) => set({ flags }),
    async launch(what, act) {
      const id = ++seq
      set({ launches: [{ ...what, id, at: now(), outcome: null }, ...get().launches].slice(0, KEPT) })
      let outcome: Outcome
      try {
        outcome = await act()
      } catch (e) {
        outcome = { ok: false, why: e instanceof Error ? e.message : String(e) }
      }
      set({ launches: get().launches.map((l) => (l.id === id ? { ...l, outcome } : l)) })
      return outcome
    },
    forget: (id) => set({ launches: get().launches.filter((l) => l.id !== id) }),
  }))
}

/** The app's one. */
export const launchStore = createLaunchStore()

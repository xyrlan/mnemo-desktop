// What is Orbit's own: the cursor standing on the centre, the centre opened, the finder.
// The selection and the open card are the fleet's and live in the route (src/world/route.ts).

import { create } from 'zustand'

export interface OrbitState {
  /** The cursor is on the centre piece, not on a body. */
  core: boolean
  /** The centre is open: the vault. */
  vault: boolean
  /** The finder's text; null when it is closed. */
  find: string | null
  /** Which of the finder's hits Enter opens. */
  hit: number
}

const REST: OrbitState = { core: false, vault: false, find: null, hit: 0 }

export const orbitStore = create<OrbitState>(() => REST)

export const useOrbit = <T,>(pick: (state: OrbitState) => T): T => orbitStore(pick)
export const setOrbit = (patch: Partial<OrbitState>): void => orbitStore.setState(patch)
export const resetOrbit = (): void => orbitStore.setState(REST)

/* The order of the projects round the rim, kept for the day: a project stays in its
   direction when another gains a session. */

const KEY = 'mnemo.orbit.sectors'

interface Kept {
  day: string
  source: string
  order: string[]
}

const day = (at: number): string => new Date(at || Date.now()).toDateString()

export function keptOrder(source: string, at: number): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Kept | null
    return kept && kept.day === day(at) && kept.source === source && Array.isArray(kept.order) ? kept.order.filter((n) => typeof n === 'string') : []
  } catch {
    return []
  }
}

export function keepOrder(source: string, at: number, order: string[]): void {
  try {
    const next = JSON.stringify({ day: day(at), source, order } satisfies Kept)
    if (localStorage.getItem(KEY) !== next) localStorage.setItem(KEY, next)
  } catch {
    // storage refused: the order is the world's
  }
}

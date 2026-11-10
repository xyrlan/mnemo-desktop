// Where the world is kept, and where it comes from. Views read it with `useWorld`; nothing
// above this folder asks the core about a session.

import { create } from 'zustand'
import { STATE_ORDER, type Pending, type Session, type World } from './types'

export const EMPTY: World = {
  source: 'live',
  at: 0,
  sessions: [],
  pending: [],
  accounts: [],
  projects: [],
  vault: { rules: null, prompts: 0, outcomes: {}, learned: [], recent: [] },
  events: [],
  errors: [],
}

/** live: this machine, from the core. sample: the synthetic world. capture: this machine as
 *  `prototypes/redesign/capture.py` last wrote it (a dev build only). */
export type WorldSource = 'live' | 'sample' | 'capture'

const KEY = 'mnemo.world'

export function worldSource(): WorldSource {
  let asked: string | null = null
  try {
    asked = new URLSearchParams(location.search).get('world') ?? localStorage.getItem(KEY)
  } catch {
    // no window, or storage refused: live
  }
  return asked === 'sample' || asked === 'capture' ? asked : 'live'
}

interface WorldState {
  world: World
  /** False until the first world arrived. */
  ready: boolean
  set(world: World): void
}

export const worldStore = create<WorldState>((set) => ({
  world: EMPTY,
  ready: false,
  set: (world) => set({ world, ready: true }),
}))

export function useWorld<T>(pick: (world: World) => T): T {
  return worldStore((s) => pick(s.world))
}

export const useWorldReady = (): boolean => worldStore((s) => s.ready)

const index = new WeakMap<World, Map<string, Session>>()

/** A session by its id or by its first 8 characters. */
export function sessionOf(world: World, id: string | null | undefined): Session | undefined {
  if (!id) return undefined
  let map = index.get(world)
  if (!map) {
    map = new Map()
    for (const s of world.sessions) {
      map.set(s.id, s)
      map.set(s.short, s)
    }
    index.set(world, map)
  }
  return map.get(id)
}

const rank = (s: Session) => STATE_ORDER.indexOf(s.state)

/** A family's most urgent state: a parent rises with its most urgent child. */
export function urgency(world: World, s: Session): number {
  let best = rank(s)
  for (const id of s.children) {
    const child = sessionOf(world, id)
    if (child) best = Math.min(best, rank(child))
  }
  return best
}

/** The sessions with no parent in the world, most urgent family first, then newest. */
export function roots(world: World): Session[] {
  return world.sessions
    .filter((s) => !s.parent || !sessionOf(world, s.parent))
    .sort((a, b) => urgency(world, a) - urgency(world, b) || (b.lastAt ?? 0) - (a.lastAt ?? 0))
}

/** A session's children, most urgent first. */
export function childrenOf(world: World, s: Session): Session[] {
  return s.children
    .map((id) => sessionOf(world, id))
    .filter((c): c is Session => !!c)
    .sort((a, b) => rank(a) - rank(b) || (b.lastAt ?? 0) - (a.lastAt ?? 0))
}

/** The root of a session's family. */
export function rootOf(world: World, s: Session): Session {
  let at = s
  for (let i = 0; i < 8 && at.parent; i++) {
    const up = sessionOf(world, at.parent)
    if (!up) break
    at = up
  }
  return at
}

/** What waits on a session, oldest first. */
export const pendingOf = (world: World, id: string): Pending[] => world.pending.filter((p) => p.session === id)

/** Every session in roster order: each root, then its children. The order keys walk. */
export function rosterOrder(world: World): Session[] {
  return roots(world).flatMap((r) => [r, ...childrenOf(world, r)])
}

/** What waits, in roster order, so walking it moves the eye down the list. */
export function pendingInOrder(world: World): Pending[] {
  const place = new Map(rosterOrder(world).map((s, i) => [s.id, i]))
  return [...world.pending].sort((a, b) => (place.get(a.session) ?? 1e9) - (place.get(b.session) ?? 1e9) || (a.since ?? 0) - (b.since ?? 0))
}

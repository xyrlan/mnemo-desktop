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

/** An ended session stays in what is shown of the present this long after its last sign of
 *  life. The world itself keeps it longer, for Score to tell the day. */
export const SHOWN_ENDED_MS = 40 * 60 * 1000

const present = new WeakMap<World, Set<string>>()

function presentIn(world: World): Set<string> {
  let set = present.get(world)
  if (set) return set
  set = new Set()
  present.set(world, set)
  const waited = new Set(world.pending.map((p) => p.session))
  for (const s of world.sessions) {
    const past = s.state === 'ended' && !s.live && !waited.has(s.id) && !s.prs.some((p) => p.state === 'open') && !(world.at - (s.lastAt ?? NaN) <= SHOWN_ENDED_MS)
    if (past) continue
    // What is still here keeps the family above it: a child is never shown without its parent.
    let at: Session | undefined = s
    for (let i = 0; i < 9 && at && !set.has(at.id); i++) {
      set.add(at.id)
      at = at.parent ? sessionOf(world, at.parent) : undefined
    }
  }
  return set
}

/** Whether a session is part of the present: anything that has not ended; an ended one for
 *  `SHOWN_ENDED_MS` after its last sign of life, or while a pull request of its own is open;
 *  and whatever stands above one of those. The rest is the past: Score draws it, nothing else. */
export const isPresent = (world: World, s: Session): boolean => presentIn(world).has(s.id)

/** The sessions of the present, in the world's order. */
export const presentSessions = (world: World): Session[] => world.sessions.filter((s) => isPresent(world, s))

/** The sessions with no parent in the world, most urgent family first, then newest. With
 *  `past`, the ones that left the present too. */
export function roots(world: World, past = false): Session[] {
  return world.sessions
    .filter((s) => (!s.parent || !sessionOf(world, s.parent)) && (past || isPresent(world, s)))
    .sort((a, b) => urgency(world, a) - urgency(world, b) || (b.lastAt ?? 0) - (a.lastAt ?? 0))
}

/** A session's children, most urgent first. With `past`, the ones that left the present too. */
export function childrenOf(world: World, s: Session, past = false): Session[] {
  return s.children
    .map((id) => sessionOf(world, id))
    .filter((c): c is Session => !!c && (past || isPresent(world, c)))
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

/** Every session of the present in roster order: each root, then its children. The order keys
 *  walk. With `past`, the ones that left the present too: Score's lines. */
export function rosterOrder(world: World, past = false): Session[] {
  return roots(world, past).flatMap((r) => [r, ...childrenOf(world, r, past)])
}

/** What waits, in roster order, so walking it moves the eye down the list. */
export function pendingInOrder(world: World): Pending[] {
  const place = new Map(rosterOrder(world).map((s, i) => [s.id, i]))
  return [...world.pending].sort((a, b) => (place.get(a.session) ?? 1e9) - (place.get(b.session) ?? 1e9) || (a.since ?? 0) - (b.since ?? 0))
}

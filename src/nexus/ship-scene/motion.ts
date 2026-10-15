import { useCallback, useLayoutEffect, useRef, useState, type AnimationEvent, type TransitionEvent } from 'react'
import type { ShipRobot } from '../ship-types'

/** The ship's motion that needs memory of the last draw (spec "Motion"). Every movement itself is
 *  CSS (`ship.css`); these hooks only say who walks, who leaves and what flashes. With reduced
 *  motion none of them starts anything. */

/** A robot that moved more than this sideways walked. */
const STEP = 2
/** `.ship-robot`'s transition, and a little more: a walk whose `transitionend` never comes (the
 *  transition was cancelled) still ends. */
export const WALK_MS = 1_400

/** Whether a robot is walking to where it now stands, and which way it faces: it faces where it
 *  went, and keeps facing that way once there. */
export function useWalk(x: number, reducedMotion: boolean): { walking: boolean; left: boolean; onTransitionEnd(e: TransitionEvent): void } {
  const prev = useRef<number | null>(null)
  const [walking, setWalking] = useState(false)
  const [left, setLeft] = useState(false)
  useLayoutEffect(() => {
    const p = prev.current
    prev.current = x
    if (p === null || reducedMotion || Math.abs(x - p) <= STEP) return
    setLeft(x < p)
    setWalking(true)
    const t = setTimeout(() => setWalking(false), WALK_MS + 300)
    return () => clearTimeout(t)
  }, [x, reducedMotion])
  const onTransitionEnd = useCallback((e: TransitionEvent) => {
    if (e.target === e.currentTarget && e.propertyName === 'transform') setWalking(false)
  }, [])
  return { walking: walking && !reducedMotion, left, onTransitionEnd }
}

/** The rule mnemo injected last, while it is new: null on the first draw (opening the view replays
 *  nothing), then the slug each time the newest one changes, until its flash ends. */
export function useNewRule(newest: string | null): { rule: string | null; flashed(e: AnimationEvent): void } {
  const prev = useRef(newest)
  const [rule, setRule] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (newest === prev.current) return
    prev.current = newest
    if (newest) setRule(newest)
  }, [newest])
  const flashed = useCallback((e: AnimationEvent) => {
    if (e.target === e.currentTarget) setRule(null)
  }, [])
  return { rule, flashed }
}

/** How a robot leaves the ship: `launch` boards its shuttle at its PR's merge; `walk` walks off
 *  (closed, or done without a PR). */
export type Exit = 'launch' | 'walk'
export type Drawn = { robot: ShipRobot; x: number; y: number }
export type Leaver = Drawn & { exit: Exit }

/** Leavers kept at once; past it the oldest go without a show. */
const MAX_LEAVERS = 30

export const exitOf = (r: ShipRobot): Exit => ((r.fate?.state ?? r.pr?.state) === 'MERGED' ? 'launch' : 'walk')

/** The robots that left this deck since the last draw, where they last stood, until their exit
 *  ends. `alive`: every robot still on the ship anywhere, so one that climbs to the bridge or folds
 *  into the hangar's stack is not leaving. */
export function useLeavers(drawn: Map<string, Drawn>, alive: ReadonlySet<string>, reducedMotion: boolean): { leavers: Leaver[]; gone(id: string): void } {
  const last = useRef<Map<string, Drawn> | null>(null)
  const [leavers, setLeavers] = useState<Leaver[]>([])
  useLayoutEffect(() => {
    const before = last.current
    last.current = drawn
    if (!before || reducedMotion) return
    const left = [...before.values()].filter((d) => !drawn.has(d.robot.id) && !alive.has(d.robot.id))
    if (!left.length) return
    const ids = new Set(left.map((d) => d.robot.id))
    setLeavers((prev) => [...prev.filter((l) => !ids.has(l.robot.id)), ...left.map((d) => ({ ...d, exit: exitOf(d.robot) }))].slice(-MAX_LEAVERS))
  }, [drawn, alive, reducedMotion])
  const gone = useCallback((id: string) => setLeavers((prev) => (prev.some((l) => l.robot.id === id) ? prev.filter((l) => l.robot.id !== id) : prev)), [])
  // One that came back is drawn as itself, not as its exit.
  return { leavers: reducedMotion ? [] : leavers.filter((l) => !alive.has(l.robot.id)), gone }
}

// Memory in flight: a mote leaves a node of the lattice for the session mnemo handed a rule
// to (hollow when the session asked for it), and one comes in from a session when a rule was
// learned. A mote is one Web Animations call on `transform`; a timer exists only while motes
// are queued, so at rest nothing ticks.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LatticeHandle } from '../ds'
import type { World } from '../world/types'
import { point, type Stage } from './layout'
import { memoryEvents, nodeFor, type MemoryEvent, type Scene } from './model'

/** How many events the first look replays, and how many may wait their turn. */
export const REPLAY = 14
const GAP = 2600

/** What flies now. The first world replays its newest events, once per run of the app (the
 *  view may be left and come back to); after that only what is new does. */
export function plan(seen: ReadonlySet<string> | null, events: MemoryEvent[], cap = REPLAY): MemoryEvent[] {
  if (!seen) return events.slice(-cap)
  return events.filter((e) => !seen.has(e.key)).slice(-cap)
}

let seen: Set<string> | null = null
/** For a test: forget what already flew. */
export const resetFlight = (): void => {
  seen = null
}

export const motionReduced = (el: Element | null): boolean => !!el?.closest('[data-motion="reduced"]') || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

export interface FlightStage {
  scene: Scene
  stage: Stage
  /** Where the lattice's canvas starts, in the scene's pixels. */
  core: { x: number; y: number }
}

/** Where an event's mote goes: its session's family, else its project's place on the rim. */
export function targetOf(e: MemoryEvent, at: FlightStage): { x: number; y: number; reach: number; body: string | null } | null {
  const body = at.scene.bodyOf(e.session)
  const placed = body && at.stage.at.get(body.id)
  if (placed) return { x: placed.x, y: placed.y, reach: placed.shape.fy, body: placed.id }
  const bead = body && at.stage.beads.find((b) => b.id === body.id)
  if (bead) return { x: bead.x, y: bead.y, reach: 6, body: null }
  const sector = at.stage.sectors.find((s) => s.name === (e.project ?? body?.project))
  return sector ? { ...point(at.stage.g, 0.99, sector.mid), reach: 6, body: null } : null
}

export const whisperOf = (e: MemoryEvent): string => (e.kind === 'read' ? 'asked · ' : e.kind === 'learned' ? 'learned · ' : '') + e.slug

function launch(e: MemoryEvent, n: number, layer: HTMLElement, handle: LatticeHandle | null, at: FlightStage): void {
  const to = targetOf(e, at)
  if (!to || typeof layer.animate !== 'function') return
  const { g } = at.stage
  const i = nodeFor(e.slug, handle?.spines ?? 32)
  const node = handle?.node(i)
  const centre = node ? { x: at.core.x + node.x, y: at.core.y + node.y } : { x: g.cx, y: g.cy }
  const inward = e.kind === 'learned'
  const [a, b] = inward ? [to, centre] : [centre, to]
  if (!inward) handle?.pulse(i)

  const el = document.createElement('div')
  el.className = 'orbit-mote'
  el.dataset.kind = e.kind
  el.dataset.asset = 'memory-mote'
  const dot = el.appendChild(document.createElement('i'))
  layer.appendChild(el)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy) || 1
  const bulge = Math.min(70, d * 0.16) * (n % 2 ? 1 : -1)
  const timing = { duration: 1100 + d * 0.9, easing: 'cubic-bezier(.45,.05,.3,1)' }
  const flight = el.animate(
    [{ transform: `translate(${a.x}px,${a.y}px)`, opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.88 }, { transform: `translate(${b.x}px,${b.y}px)`, opacity: 0 }],
    timing,
  )
  dot.animate([{ transform: 'translate(0,0)', easing: 'ease-out' }, { transform: `translate(${((-dy / d) * bulge).toFixed(1)}px,${((dx / d) * bulge).toFixed(1)}px)`, easing: 'ease-in' }, { transform: 'translate(0,0)' }], timing)
  flight.onfinish = () => {
    el.remove()
    if (!layer.isConnected) return
    if (inward) handle?.pulse(i)
    const said = document.createElement('div')
    said.className = 'orbit-whisper'
    said.textContent = whisperOf(e)
    said.style.transform = inward ? `translate(${g.cx.toFixed(0)}px,${(g.cy - g.ry * 0.21 - 8).toFixed(0)}px)` : `translate(${to.x.toFixed(0)}px,${(to.y - to.reach - 10).toFixed(0)}px)`
    layer.appendChild(said)
    said.addEventListener('animationend', () => said.remove())
  }
}

export interface Flight {
  /** The event in the air, for the line that names it. */
  flying: MemoryEvent | null
  /** How many memory events the world knows of, and the newest. */
  count: number
  last: MemoryEvent | null
  /** Play the newest ones again. */
  replay(): void
}

/** Runs the motes. `quiet` while the scene is not the thing looked at (the centre is open). */
export function useFlight(world: World, at: FlightStage, layer: RefObject<HTMLElement | null>, lattice: RefObject<LatticeHandle | null>, quiet: boolean): Flight {
  const events = useMemo(() => memoryEvents(world), [world])
  const [flying, setFlying] = useState<MemoryEvent | null>(null)
  const run = useRef({ queue: [] as MemoryEvent[], timer: 0, n: 0 })
  const now = useRef({ at, quiet })
  now.current = { at, quiet }

  const stop = useCallback(() => {
    window.clearTimeout(run.current.timer)
    run.current.timer = 0
    run.current.queue = []
    setFlying(null)
  }, [])

  const fly = useCallback(() => {
    const r = run.current
    r.timer = 0
    const e = r.queue.shift()
    const el = layer.current
    if (!e || !el || document.hidden || now.current.quiet || motionReduced(el)) return stop()
    launch(e, r.n++, el, lattice.current, now.current.at)
    setFlying(e)
    // one more turn after the last mote: it takes the line down, and then no timer is left
    r.timer = window.setTimeout(fly, GAP)
  }, [layer, lattice, stop])

  const queue = useCallback(
    (list: MemoryEvent[], soon: number) => {
      const r = run.current
      if (!list.length || now.current.quiet || document.hidden || motionReduced(layer.current)) return
      r.queue = [...r.queue, ...list].slice(-REPLAY)
      if (!r.timer) r.timer = window.setTimeout(fly, soon)
    },
    [fly, layer],
  )

  useEffect(() => {
    if (!world.at) return
    const fresh = plan(seen, events)
    seen = new Set(events.map((e) => e.key))
    queue(fresh, 600)
  }, [events, queue, world.at])

  useEffect(() => {
    if (quiet) {
      stop()
      layer.current?.replaceChildren()
    }
  }, [quiet, stop, layer])

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      const r = run.current
      window.clearTimeout(r.timer)
      r.timer = 0
      // what never flew may fly when the view is back
      for (const e of r.queue) seen?.delete(e.key)
      r.queue = []
    }
  }, [stop])

  return { flying, count: events.length, last: events[events.length - 1] ?? null, replay: () => queue(events.slice(-REPLAY), 300) }
}

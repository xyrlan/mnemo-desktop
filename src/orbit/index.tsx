// Orbit: the fleet as one scene, where distance is attention and direction is the project
// (docs/superpowers/specs/2026-11-10-recreation-design.md). At the centre is mnemo's memory;
// round it every root session is a body with its children as moons, each carrying its full
// title; a rule handed to a session travels from the lattice to its body.
//
// model.ts says what the world means here, layout.ts where everything stands, scene.tsx how
// it is drawn. The selection and the open card are the fleet's (the route); the cursor on
// the centre, the opened centre and the finder are Orbit's own (state.ts).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Figure, Kbd, Lattice, type LatticeHandle } from '../ds'
import { contextMenu, drawsSession } from '../menu'
import { PendingCard, armedPending } from '../pending'
import { go, openOnStage, routeStore, select, useRoute } from '../world/route'
import { pendingOf, sessionOf, useWorld } from '../world/store'
import type { Pending, Session } from '../world/types'
import { Finder } from './finder'
import { useFlight } from './flight'
import { cardPlace, chartOf, checkLabels, coreObstacle, coreRadius, firstNode, geom, labelBounds, labelItems, leaderOf, neighbour, solveLabels, stageOf, type LabelItem, type Obstacle, type Spot, type Stage } from './layout'
import { OrbitMap } from './map'
import { KIND_STATE, buildScene, findSessions, pinOrder } from './model'
import { BodyMark, ChartArt, LabelText } from './scene'
import { keepOrder, keptOrder, setOrbit, useOrbit } from './state'
import { Vault } from './vault'
import './orbit.css'

export { OrbitMap }

/** The letters that are the frame's in every view (the design's table of keys): typing any
 *  other finds a session, and `/` opens the finder for a name that starts with one of these. */
const FLEET_LETTERS = 'qnrhctm'

/** The card's width in em, as orbit.css has it. */
const CARD_EM = 28

interface Box {
  W: number
  H: number
  em: number
}

/** What the scene is laid out for before it was measured (and where nothing measures). */
const UNMEASURED: Box = { W: 1920, H: 1026, em: 14 }

function useBox(ref: RefObject<HTMLElement | null>): Box {
  const [box, setBox] = useState(UNMEASURED)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      if (!W || !H) return
      const em = parseFloat(getComputedStyle(el).fontSize) || UNMEASURED.em
      setBox((b) => (b.W === W && b.H === H && b.em === em ? b : { W, H, em }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const seen = new ResizeObserver(read)
    seen.observe(el)
    return () => seen.disconnect()
  }, [ref])
  return box
}

/** Counts up when a typeface arrives, so labels measured in a fallback are measured again. */
function useFonts(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts?.addEventListener) return
    const bump = () => setN((x) => x + 1)
    fonts.ready.then(bump).catch(() => {})
    fonts.addEventListener('loadingdone', bump)
    return () => fonts.removeEventListener('loadingdone', bump)
  }, [])
  return n
}

interface Labels {
  spots: Map<string, Spot>
  items: LabelItem[]
  dense: boolean
}

/** Places the labels: measures each as it came out, runs the solver, and when the full
 *  labels cannot all stand cleanly lets them shed their second lines and runs it again. */
function useLabels(root: RefObject<HTMLElement | null>, host: RefObject<HTMLElement | null>, stage: Stage, fixed: Obstacle[], epoch: number): Labels | null {
  const [labels, setLabels] = useState<Labels | null>(null)
  const last = useRef<{ sig: string; frame: string; keys: Map<string, string>; dense: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const { g } = stage
    // A first draw, a new size or a new body is not a move: nothing travels to its place.
    // Said before anything is measured, because measuring is what starts a transition.
    const frame = `${g.W}x${g.H}@${g.em}|${stage.placed.map((p) => p.id).join(',')}`
    root.current?.setAttribute('data-still', String(frame !== last.current?.frame))

    const nodes = new Map<string, HTMLElement>()
    for (const child of Array.from(el.children) as HTMLElement[]) if (child.dataset.label) nodes.set(child.dataset.label, child)
    const measure = () => labelItems(stage, new Map(stage.placed.map((p) => [p.id, { w: Math.ceil(nodes.get(p.id)?.offsetWidth ?? 0), h: Math.ceil(nodes.get(p.id)?.offsetHeight ?? 0) }])))

    el.removeAttribute('data-dense')
    let items = measure()
    const sig = `${frame}|${epoch}|` + items.map((it) => `${Math.round(it.x)},${Math.round(it.y)},${it.w},${it.h}`).join(';')
    if (last.current?.sig === sig) {
      if (last.current.dense) el.setAttribute('data-dense', 'true')
      return
    }
    const bounds = labelBounds(g)
    const before = last.current?.frame === frame ? last.current.keys : undefined
    let spots = solveLabels(items, fixed, bounds, g.f, before)
    const bad = checkLabels(items, spots, bounds)
    const dense = bad.overlap + bad.onBody + bad.clipped > 0
    if (dense) {
      el.setAttribute('data-dense', 'true')
      items = measure()
      spots = solveLabels(items, fixed, bounds, g.f, before)
    }
    last.current = { sig, frame, dense, keys: new Map([...spots].map(([id, s]) => [id, s.key])) }
    setLabels({ spots, items, dense })
  }, [root, host, stage, fixed, epoch])
  return labels
}

const clock = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The whole-window scene: the view the app opens on. */
export function OrbitView() {
  const world = useWorld((w) => w)
  const route = useRoute((r) => r)
  const local = useOrbit((s) => s)
  const root = useRef<HTMLElement>(null)
  const labelHost = useRef<HTMLDivElement>(null)
  const moteLayer = useRef<HTMLDivElement>(null)
  const lattice = useRef<LatticeHandle | null>(null)
  const box = useBox(root)
  const fonts = useFonts()

  const scene = useMemo(() => buildScene(world, { order: keptOrder(world.source, world.at) }), [world])
  useEffect(() => {
    // a project whose sessions are gone for now keeps its place for when one comes back
    if (scene.projects.length) keepOrder(world.source, world.at, pinOrder(scene.projects.map((p) => p.name), keptOrder(world.source, world.at)))
  }, [scene, world.source, world.at])

  const g = useMemo(() => geom(box.W, box.H, box.em), [box.W, box.H, box.em])
  const stage = useMemo(() => stageOf(scene, g), [scene, g])
  const needs = scene.bodies.filter((b) => b.band === 'need').length
  const chart = useMemo(() => chartOf(g, stage.sectors, needs, scene.folded.length), [g, stage.sectors, needs, scene.folded.length])
  const fixed = useMemo<Obstacle[]>(() => [coreObstacle(g), ...chart.obstacles, { x0: 0, y0: 0, x1: 30 * g.em, y1: 2.2 * g.em, weight: 4 }], [g, chart])
  const labels = useLabels(root, labelHost, stage, fixed, fonts)

  // The cursor: on the centre, or on the body of the fleet's selection.
  const cursor = local.core ? null : scene.bodyOf(route.session)
  const card = armedPending(world, route)
  const asked = card ? scene.bodyOf(card.session) : undefined
  const hits = useMemo(() => (local.find == null ? [] : findSessions(world, local.find)), [world, local.find])
  const matched = useMemo(() => new Set(hits.map((s) => scene.bodyOf(s.id)?.id)), [hits, scene])

  const side = coreRadius(g) * 2.25
  const grown = Math.min(side * 1.75, g.W * 0.3, g.H * 0.62)
  const flightAt = useMemo(() => ({ scene, stage, core: { x: g.cx - side / 2, y: g.cy - side / 2 } }), [scene, stage, g, side])
  const flight = useFlight(world, flightAt, moteLayer, lattice, local.vault)

  // When the last thing that waited is answered, a ring crosses the scene once.
  const [settled, setSettled] = useState(0)
  const waited = useRef(world.pending.length)
  useEffect(() => {
    if (waited.current > 0 && world.pending.length === 0) setSettled((n) => n + 1)
    waited.current = world.pending.length
  }, [world.pending.length])

  // Keys are Orbit's only while focus is inside it: it takes focus when nothing else has it.
  useEffect(() => {
    const el = root.current
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true })
  }, [])
  const refocus = useCallback(() => root.current?.focus({ preventScroll: true }), [])
  // the finder does not outlive the view; the opened centre and the cursor do
  useEffect(() => () => setOrbit({ find: null, hit: 0 }), [])
  // a mote's path was worked out for the size it left at
  useEffect(() => moteLayer.current?.replaceChildren(), [g])

  /** The centre takes the cursor from whatever body had it, so no card stays armed unseen. */
  const toCentre = useCallback((vault: boolean) => {
    setOrbit({ core: true, vault })
    if (routeStore.getState().route.session) select(null)
  }, [])

  const open = useCallback((id: string) => {
    setOrbit({ core: false, vault: false, find: null })
    openOnStage(id)
  }, [])
  const ask = useCallback((p: Pending) => {
    setOrbit({ core: false, vault: false })
    go({ session: p.session, pending: p.id })
  }, [])
  const onMoon = useCallback(
    (s: Session) => {
      const waits = pendingOf(world, s.id)[0]
      if (waits) ask(waits)
      else open(s.id)
    },
    [world, ask, open],
  )
  const closeFinder = useCallback(() => {
    setOrbit({ find: null, hit: 0 })
    refocus()
  }, [refocus])

  const move = (dx: number, dy: number): void => {
    const nodes = [...stage.placed.map((p) => ({ id: p.id, x: p.x, y: p.y })), { id: 'core', x: g.cx, y: g.cy }]
    const from = local.core ? nodes[nodes.length - 1] : nodes.find((node) => node.id === cursor?.id)
    const to = from ? neighbour(nodes, from, dx, dy)?.id : (firstNode(stage) ?? 'core')
    if (!to) return
    if (to === 'core') return toCentre(false)
    setOrbit({ core: false })
    select(to)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    // never inside a text field or a terminal: there a key is what was typed
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], .xterm')) return
    const now = routeStore.getState().route
    if (now.command || now.panel) return
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const key = e.key
    if (arrows[key]) {
      if (!local.vault) move(...arrows[key])
    } else if (key === 'Enter') {
      if (local.vault) return
      if (local.core) toCentre(true)
      else if (sessionOf(world, now.session)) open(now.session!)
      else return
    } else if (key === 'Home') toCentre(!local.vault)
    else if (key === 'Escape') {
      if (local.vault) setOrbit({ vault: false, core: true })
      else if (now.pending) go({ pending: null })
      else if (local.core) setOrbit({ core: false })
      else if (now.session) select(null)
      else return
    } else if (key === '/' || (/^\p{L}$/u.test(key) && !FLEET_LETTERS.includes(key.toLowerCase()))) setOrbit({ find: key === '/' ? '' : key, hit: 0 })
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const where = card && asked ? labels?.spots.get(asked.id) : undefined
  const cardAt = where ? cardPlace(g, where, CARD_EM * g.em) : null
  const cardOf = card ? sessionOf(world, card.session) : undefined
  const state = local.find != null ? 'find' : local.vault ? 'vault' : card ? 'card' : 'scene'

  return (
    <section
      ref={root}
      className="orbit"
      data-view="orbit"
      data-open={local.vault ? 'vault' : undefined}
      data-find={local.find != null || undefined}
      tabIndex={-1}
      aria-label="Sessions in orbit"
      onKeyDown={onKeyDown}
      onContextMenu={contextMenu}
      onClick={() => {
        if (local.find != null) closeFinder()
        else if (routeStore.getState().route.pending) go({ pending: null })
      }}
    >
      <ChartArt g={g} chart={chart} />

      <div
        className="orbit-core"
        data-cursor={(local.core && !local.vault) || undefined}
        role="button"
        aria-label="Open memory"
        style={{ transform: `translate(${g.cx.toFixed(1)}px,${g.cy.toFixed(1)}px)` }}
        onClick={(e) => {
          e.stopPropagation()
          toCentre(!local.vault)
        }}
      >
        <div className="orbit-core-in" style={{ width: local.vault ? grown : side, height: local.vault ? grown : side }}>
          <Lattice onReady={(handle) => (lattice.current = handle)} />
          <i className="orbit-core-ring" />
        </div>
        <div className="orbit-core-cap" style={{ top: coreRadius(g) * 1.09 }}>
          <b className="mn-num">{world.vault.rules == null ? '–' : world.vault.rules.toLocaleString('en-US')}</b> rules in memory
        </div>
      </div>

      <div className="orbit-leaders" aria-hidden="true">
        {labels?.items.map((it) => {
          const spot = labels.spots.get(it.id)
          const line = spot && stage.at.has(it.id) ? leaderOf(it, spot, g.f) : null
          return line && <i key={it.id} style={{ width: line.length, transform: `translate(${line.x.toFixed(1)}px,${line.y.toFixed(1)}px) rotate(${line.angle.toFixed(4)}rad)` }} />
        })}
      </div>

      <div className="orbit-bodies">
        {stage.placed.map((p) => (
          <BodyMark key={p.id} world={world} g={g} p={p} cursor={cursor?.id === p.id} asked={asked?.id === p.id ? card!.session : null} matched={matched.has(p.id)} onOpen={open} onMoon={onMoon} />
        ))}
        {stage.beads.map((b) => (
          <i
            key={b.id}
            className="orbit-bead"
            data-bead={b.id}
            {...drawsSession(b.id)}
            data-match={matched.has(b.id) || undefined}
            data-cursor={cursor?.id === b.id || undefined}
            title={`${b.body.root.title} · ended`}
            style={{ transform: `translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px)` }}
            onClick={(e) => {
              e.stopPropagation()
              open(b.id)
            }}
          />
        ))}
      </div>

      <div className="orbit-labels" ref={labelHost} data-dense={labels?.dense ? 'true' : undefined}>
        {stage.placed.map((p) => (
          <LabelText key={p.id} world={world} body={p.body} roomy={g.em >= 14} cursor={cursor?.id === p.id} matched={matched.has(p.id)} asked={asked?.id === p.id} spot={labels?.spots.get(p.id)} onOpen={open} onWant={ask} />
        ))}
      </div>

      <div className="orbit-motes" ref={moteLayer} aria-hidden="true" />
      {settled > 0 && (
        <div key={settled} className="orbit-settle" data-asset="settle-wave" style={{ transform: `translate(${g.cx}px,${g.cy}px)` }} onAnimationEnd={() => setSettled(0)}>
          <i style={{ width: g.rx * 2, height: g.rx * 2, left: -g.rx, top: -g.rx, ['--k' as string]: g.k.toFixed(3) }} />
        </div>
      )}

      {world.at > 0 && !world.sessions.length && <p className="orbit-empty">Nothing in orbit: no session is running here.</p>}

      {card && cardOf && cardAt && (
        <div
          className="orbit-card"
          data-orbit-card={card.id}
          {...drawsSession(cardOf.id)}
          data-state={KIND_STATE[card.kind]}
          style={{ left: cardAt.left, top: cardAt.top ?? undefined, bottom: cardAt.bottom ?? undefined, maxHeight: cardAt.maxHeight }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="orbit-card-head">
            <Figure id={cardOf.id} size={22} />
            <span>
              <b>{cardOf.title}</b>
              {asked && asked.id !== cardOf.id && (
                <small>
                  a child of <em>{asked.root.title}</em>
                </small>
              )}
            </span>
          </div>
          <PendingCard pending={card} armed />
        </div>
      )}

      {local.vault && <Vault world={world} onClose={() => setOrbit({ vault: false, core: true })} onOpen={open} />}
      {local.find != null && <Finder world={world} text={local.find} hits={hits} hit={Math.min(local.hit, Math.max(0, hits.length - 1))} onText={(find) => setOrbit({ find, hit: 0 })} onHit={(hit) => setOrbit({ hit })} onOpen={(s) => open(s.id)} onClose={closeFinder} />}

      <div className="orbit-tick" data-flying={flight.flying?.kind}>
        {flight.flying ? (
          <span>
            <i>✦</i> memory <b className="mn-num">{clock(flight.flying.at)}</b> {flight.flying.kind === 'read' ? 'asked · ' : flight.flying.kind === 'learned' ? 'learned · ' : ''}
            <span className="mn-mono">{flight.flying.slug}</span>
            {sessionOf(world, flight.flying.session) && (
              <>
                {' '}
                <i>{flight.flying.kind === 'learned' ? '←' : '→'}</i> {sessionOf(world, flight.flying.session)!.title.slice(0, 44)}
              </>
            )}
          </span>
        ) : flight.count > 0 ? (
          <button type="button" data-replay onClick={(e) => (e.stopPropagation(), flight.replay())}>
            <i>✦</i> memory moved <b className="mn-num">{flight.count}</b> {flight.count === 1 ? 'time' : 'times'} lately · replay the last {Math.min(14, flight.count)}
          </button>
        ) : null}
      </div>

      <footer className="orbit-keys" data-keys={state}>
        {state === 'find' ? (
          <>
            <span><Kbd>↑ ↓</Kbd> choose</span>
            <span><Kbd>Enter</Kbd> open</span>
            <span><Kbd>Esc</Kbd> close</span>
          </>
        ) : state === 'vault' ? null : (
          <>
            <span><Kbd>← ↑ ↓ →</Kbd> move</span>
            <span><Kbd>Enter</Kbd> open on stage</span>
            <span><Kbd>a–z</Kbd> find a session</span>
            <span><Kbd>Home</Kbd> memory</span>
            {state === 'card' && <span><Kbd>Esc</Kbd> close the card</span>}
          </>
        )}
      </footer>
    </section>
  )
}

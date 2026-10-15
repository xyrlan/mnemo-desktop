import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { pollWhileShown } from '../shell/while-shown'
import { useArrivals } from './scene/motion'
import { Bridge } from './ship-scene/Bridge'
import { SceneContext, type SceneCtx } from './ship-scene/context'
import { Deck } from './ship-scene/Deck'
import { CaptainChip, px, type Hover } from './ship-scene/figures'
import { columns, G } from './ship-scene/geometry'
import { ShipLog } from './ship-scene/Log'
import { TURN_MS } from './ship-scene/voices'
import { chips, rateChip } from './ship-scene/words'
import type { Ship, ShipRobot, ShipSceneProps } from './ship-types'
import './ship.css'

/** The scroll box's inner width where nothing is laid out (jsdom). */
const UNMEASURED = 1200

/** The scroll box's inner width, null until it is first read: the ship is drawn at its real width
 *  from the start, or every robot would walk from a guessed spot on the first frame. */
function useWidth(ref: RefObject<HTMLDivElement | null>): number | null {
  const [w, setW] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW((w) => (el.clientWidth > 0 ? el.clientWidth : (w ?? UNMEASURED)))
    read()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

const robotsOf = (ship: Ship): ShipRobot[] => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]

/** The ship drawn (v2 spec "What it is"): the top bar's counts, the bridge with what waits for you
 *  and the fleet prompt, a deck per repo with live children, the docks, and the ship's log. Every
 *  motion is CSS (`ship.css`): with reduced motion nothing walks, flies or loops, and while the
 *  window is hidden all of it pauses. */
export function ShipScene({ ship, log, focusId, selection, onOpen, onSelect, onAction, onTriage, bridge, reducedMotion, visible }: ShipSceneProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const box = useWidth(scroller)
  const width = Math.max(G.minWidth, (box ?? UNMEASURED) - 2 * G.pad)

  const robots = useMemo(() => robotsOf(ship), [ship])
  const byId = useMemo(() => new Map(robots.map((r) => [r.id, r])), [robots])
  const alive = useMemo(() => new Set(byId.keys()), [byId])
  const emblems = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of ship.decks) for (const c of [...d.captains, ...d.quiet]) m.set(c.id, c.emblem)
    for (const d of ship.docks) for (const c of d.captains) m.set(c.id, c.emblem)
    return m
  }, [ship])
  const ids = useMemo(() => robots.map((r) => r.id), [robots])
  const { arriving, arrived } = useArrivals(ids, reducedMotion)

  const [hover, setHover] = useState<Hover | null>(null)
  // Speech turns: only while turns are taken and someone can see them.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (reducedMotion || !visible) return
    return pollWhileShown(() => setTick((n) => n + 1), TURN_MS, { wait: true })
  }, [reducedMotion, visible])

  // The figure open in the drawer is scrolled into view, once the ship is drawn.
  const drawn = box !== null
  useEffect(() => {
    if (!focusId || !drawn) return
    const el = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-ship-id]') ?? [])].find((e) => e.dataset.shipId === focusId || e.dataset.session === focusId)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reducedMotion ? 'auto' : 'smooth',
      })
    }
  }, [focusId, reducedMotion, drawn])

  const ctx: SceneCtx = {
    emblems,
    robots: byId,
    selection,
    focusId,
    hover,
    setHover,
    arriving,
    arrived,
    reducedMotion,
    tick,
    onOpen,
    onSelect,
    onAction,
    onTriage,
  }
  const c = chips(ship.counts)
  const rate = rateChip(ship.rate)
  const cols = columns(width)

  return (
    <SceneContext.Provider value={ctx}>
      <div className="ship-scene" data-ship-scene="" data-reduced={reducedMotion ? '' : undefined} data-paused={visible ? undefined : ''}>
        <header className="ship-top">
          <span className="ship-brand">NEXUS</span>
          <span className="ship-chip" data-chip="working">
            {c.working}
          </span>
          <button
            type="button"
            className="ship-chip"
            data-chip="need"
            data-zero={ship.counts.need ? undefined : ''}
            disabled={!ship.counts.need}
            title="triage what needs you (Tab)"
            onClick={onTriage}
          >
            {c.need}
          </button>
          <span className="ship-chip" data-chip="ready">
            {c.ready}
          </span>
          <span className="ship-chip" data-chip="rate" title={rate.title}>
            {rate.text}
          </span>
        </header>
        <div ref={scroller} className="ship-space">
          {drawn && (
            <div className="ship-stage" style={{ width: px(width + 2 * G.pad) }}>
              <Bridge ship={ship} prompt={bridge} />
              {ship.decks.length > 0 && (
                <div className="ship-colhead" aria-hidden>
                  <div style={{ width: px(cols.cmdW) }}>
                    COMMAND <small>parents</small>
                  </div>
                  {cols.rooms.map((r) => (
                    <div key={r.zone} style={{ width: px(r.w) }}>
                      {r.label} <small>{r.hint}</small>
                    </div>
                  ))}
                </div>
              )}
              {ship.decks.map((d) => (
                <Deck key={d.root} deck={d} width={width} alive={alive} />
              ))}
              {ship.docks.length > 0 && (
                <section className="ship-docks" aria-label="docks">
                  <b>DOCKS</b>
                  {ship.docks.map((d) => (
                    <div key={d.root} className="ship-pod" data-dock={d.root}>
                      <span>{d.name}</span>
                      {d.captains.map((cap) => (
                        <CaptainChip key={cap.id} captain={cap} focused={focusId === cap.id} onOpen={onOpen} />
                      ))}
                    </div>
                  ))}
                </section>
              )}
              {!ship.decks.length && !ship.docks.length && <p className="ship-empty">No live sessions.</p>}
            </div>
          )}
        </div>
        <ShipLog log={log} />
      </div>
    </SceneContext.Provider>
  )
}

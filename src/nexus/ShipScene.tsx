import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { pollWhileShown } from '../shell/while-shown'
import { Bridge } from './ship-scene/Bridge'
import { SceneContext, type SceneCtx } from './ship-scene/context'
import { Deck } from './ship-scene/Deck'
import { DockedCaptain, px, type Hover } from './ship-scene/figures'
import { columns, G } from './ship-scene/geometry'
import { useArrivals } from './ship-scene/motion'
import { ShipLog } from './ship-scene/Log'
import { TURN_MS } from './ship-scene/voices'
import { emptyText, rateChip } from './ship-scene/words'
import type { Deck as DeckT, Ship, ShipRobot, ShipSceneProps } from './ship-types'
import type { MenuTarget } from './ui/menus'
import { openWindow } from './ui/windows'
import { ShipAccounts } from './accounts/ShipAccounts'
import './ship.css'
import markUrl from '../brand/mark.svg?url'

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

/** A `.dark` box at the end of `<body>` for the account switcher's popup: in the hull's scheme
 *  whatever the app's (its utilities' `dark:` reads an ancestor), and above the drawer. */
function useDarkLayer(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const d = document.body.appendChild(document.createElement('div'))
    d.className = 'dark'
    d.dataset.shipLayer = ''
    setEl(d)
    return () => d.remove()
  }, [])
  return el
}

type Drawn = { deck: DeckT; ghost: boolean }

/** The decks to draw: the ship's, plus each deck that just left it (its last child merged or
 *  closed), emptied and kept where it stood until its robots' exits end. Not with reduced motion,
 *  where nobody makes an exit. */
function useDecks(decks: DeckT[], reducedMotion: boolean): { decks: Drawn[]; settled(root: string): void } {
  type Ghost = { deck: DeckT; index: number }
  const last = useRef<DeckT[]>(decks)
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const roots = new Set(decks.map((d) => d.root))
  // Found while drawing, so the deck that left keeps its place (and its memory) in this very commit.
  const kept = reducedMotion ? [] : ghosts.filter((g) => !roots.has(g.deck.root))
  const left: Ghost[] = reducedMotion
    ? []
    : last.current.flatMap((d, index) => (roots.has(d.root) || kept.some((g) => g.deck.root === d.root) ? [] : [{ deck: { ...d, flight: [], hangar: [], stranded: [], hangarReady: false }, index }]))
  const all = [...kept, ...left]
  useLayoutEffect(() => {
    last.current = decks
    if (left.length || all.length !== ghosts.length) setGhosts(all)
  })
  const settled = useCallback((root: string) => setGhosts((prev) => (prev.some((g) => g.deck.root === root) ? prev.filter((g) => g.deck.root !== root) : prev)), [])
  const out: Drawn[] = decks.map((deck) => ({ deck, ghost: false }))
  for (const g of [...all].sort((a, b) => a.index - b.index)) out.splice(Math.min(g.index, out.length), 0, { deck: g.deck, ghost: true })
  return { decks: out, settled }
}

const robotsOf = (ship: Ship): ShipRobot[] => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]

/** The ship drawn (v2 spec "What it is"): the top bar's rate chip, the account the app runs on and
 *  PROJECTS, MISSIONS and SYSTEMS, the bridge with what waits for you, a deck per repo with live
 *  children, the docks, and the ship's log; over the bridge's top edge, the command line while open. Every motion is CSS (`ship.css`): with reduced motion nothing walks, flies or loops,
 *  and while the window is hidden all of it pauses. */
export function ShipScene({ ship, log, focusId, selection, onOpen, onSelect, onAction, onTriage, onCommand, onMenu, command, reducedMotion, visible }: ShipSceneProps): JSX.Element {
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
  const merged = useMemo(() => new Set(log.flatMap((e) => (e.kind === 'merged' && e.robotId ? [e.robotId] : []))), [log])
  const { decks, settled } = useDecks(ship.decks, reducedMotion)

  const [hover, setHover] = useState<Hover | null>(null)
  const dark = useDarkLayer()
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
    merged,
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
    onCommand,
  }
  const rate = rateChip(ship.rate)
  const cols = columns(width)

  return (
    <SceneContext.Provider value={ctx}>
      <div
        className="ship-scene"
        data-ship-scene=""
        data-reduced={reducedMotion ? '' : undefined}
        data-paused={visible ? undefined : ''}
        onContextMenu={(e) => {
          const t = menuTarget(e.target as HTMLElement, ship)
          if (!t) return
          e.preventDefault()
          onMenu(t, e.clientX, e.clientY)
        }}
      >
        <header className="ship-top">
          <img className="ship-brand" src={markUrl} alt="mnemo" title="mnemo" width={21} height={28} draggable={false} />
          <span className="ship-chip" data-chip="rate" title={rate.title}>
            {rate.text}
          </span>
          <ShipAccounts portal={dark} />
          <nav className="ship-nav" aria-label="ship">
            <button type="button" className="ship-navbtn" onClick={() => openWindow('projects')}>
              PROJECTS
            </button>
            <button type="button" className="ship-navbtn" onClick={() => openWindow('missions')}>
              MISSIONS
            </button>
            <button
              type="button"
              className="ship-navbtn"
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                onMenu({ kind: 'systems', id: '' }, r.left, r.bottom + 4)
              }}
            >
              SYSTEMS ▾
            </button>
          </nav>
        </header>
        <div ref={scroller} className="ship-space">
          {drawn && (
            <div className="ship-stage" style={{ width: px(width + 2 * G.pad) }}>
              <Bridge ship={ship} />
              {decks.length > 0 && (
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
              {decks.map(({ deck: d, ghost }) => (
                <Deck key={d.root} deck={d} width={width} alive={alive} ghost={ghost} onSettled={settled} />
              ))}
              {ship.docks.length > 0 && (
                <section className="ship-docks" aria-label="docks">
                  <b>DOCKS</b>
                  {ship.docks.map((d) => (
                    <div key={d.root} className="ship-pod" data-dock={d.root}>
                      <span>{d.name}</span>
                      {d.captains.map((cap) => (
                        <DockedCaptain key={cap.id} captain={cap} focused={focusId === cap.id} onOpen={onOpen} />
                      ))}
                    </div>
                  ))}
                </section>
              )}
              {!decks.length && !ship.docks.length && <p className="ship-empty">{emptyText(ship)}</p>}
            </div>
          )}
        </div>
        {command}
        <ShipLog log={log} />
      </div>
    </SceneContext.Provider>
  )
}

/** What a right-click landed on: the nearest figure (a robot or a captain, told apart by the ship),
 *  else the deck or the dock around it. */
function menuTarget(el: HTMLElement, ship: Ship): MenuTarget | null {
  const fig = el.closest<HTMLElement>('[data-ship-id]')
  if (fig) {
    const id = fig.dataset.shipId!
    const robots = [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]
    return robots.some((r) => r.id === id) ? { kind: 'robot', id } : { kind: 'captain', id }
  }
  const deck = el.closest<HTMLElement>('[data-deck]')
  if (deck) return { kind: 'deck', id: deck.dataset.deck! }
  const dock = el.closest<HTMLElement>('[data-dock]')
  if (dock) return { kind: 'dock', id: dock.dataset.dock! }
  return null
}

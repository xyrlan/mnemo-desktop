// The frame: the top bar, the layout of each view, the fleet-wide keys, the key sheet and the
// command line (docs/superpowers/specs/2026-11-10-recreation-design.md, "The frame"). Every
// view is another piece's; the frame gives each its room and keeps the selection between them.

import { watchAway } from './away'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@fontsource-variable/jura'
import '../ds/tokens.css'
import './frame.css'
import { CommandLine, escapeCommand, openCommand } from '../command'
import { Starfield } from '../ds'
import { Instruments } from '../instruments'
import { Menu, menuByKey } from '../menu'
import { OrbitView } from '../orbit'
import { Panels } from '../panels'
import { answerArmed, nextPending, replyArmed } from '../pending'
import { Roster, rosterShown } from '../roster'
import { plainTerminals } from '../roster/terminals'
import { startRuntime, useHosted } from '../runtime'
import { ScoreView } from '../score'
import { Stage, focusTerminal as focusStage } from '../stage'
import { go, routeStore, useRoute, type View } from '../world/route'
import { startWorld } from '../world/start'
import { rosterOrder, sessionOf, useWorld, worldSource, worldStore } from '../world/store'
import { Boot, bootsNow, type BootPhase } from './Boot'
import { useJames } from './james'
import { KeyHints, KeySheet, sheetStore } from './KeySheet'
import { createBack, focusTerminal, press, whereOf, type Fleet } from './keys'
import { still, useReduced } from './motion'
import { PanelBar, TopBar, Unread } from './TopBar'

/** Left to right, as the top bar has them: a change of view moves that way. */
const ORDER: readonly View[] = ['orbit', 'console', 'score']

/** How long a change of view takes (`--frame-move` in frame.css). */
export const MOVE_MS = 320

/** Console: the roster, the stage, and the instruments of the session on stage. `wide` gives
 *  the instruments' room to the stage. */
function ConsoleLayout() {
  const session = useRoute((r) => r.session)
  const wide = useRoute((r) => r.wide)
  const known = useWorld((w) => !!sessionOf(w, session))
  const sessions = useWorld((w) => w.sessions.length)
  const hosted = useHosted()
  // A terminal the app holds that is no session (a shell, a command) stands on stage as one does.
  const terminal = !known && !!session && hosted.some((h) => h.id === session)

  // Console is never without a session on stage: with none chosen, the first in roster order.
  useEffect(() => {
    if (known || terminal || !sessions) return
    const first = rosterOrder(worldStore.getState().world)[0]
    if (first) go({ session: first.id })
  }, [known, terminal, sessions])

  const instruments = known && !wide
  return (
    <div className="frame-console" data-wide={wide || undefined} data-instruments={instruments || undefined}>
      <div className="frame-col" data-col="roster">
        <Roster />
      </div>
      <div className="frame-col" data-col="stage">
        <Stage />
      </div>
      {instruments && session && (
        <div className="frame-col" data-col="instruments">
          <Instruments sessionId={session} />
        </div>
      )}
    </div>
  )
}

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

/** The transform (from its own top left corner) that draws `scene` whole inside `map`, centred,
 *  at one scale. Null when either has no size to speak of. */
export function contraction(scene: Box, map: Box): string | null {
  if (!(scene.width > 0 && scene.height > 0 && map.width > 0 && map.height > 0)) return null
  const s = Math.min(map.width / scene.width, map.height / scene.height)
  const x = map.left - scene.left + (map.width - scene.width * s) / 2
  const y = map.top - scene.top + (map.height - scene.height * s) / 2
  return `translate(${x}px, ${y}px) scale(${s})`
}

/** Where the leaving view goes (`leave`) and where the arriving one comes from (`arrive`), as
 *  transforms. Orbit and Console share the scene: it contracts into the roster's map ("where it
 *  stands"), and opens out of it, while Console stays put. Otherwise, or with no map to be
 *  found, the two slide the way the top bar reads. */
export function continuity(from: View, to: View, scene: Box | null, map: Box | null): { leave: string; arrive: string } {
  const small = scene && map && (from === 'orbit' || to === 'orbit') ? contraction(scene, map) : null
  if (small) return from === 'orbit' ? { leave: small, arrive: 'none' } : { leave: 'none', arrive: small }
  const dir = ORDER.indexOf(to) > ORDER.indexOf(from) ? 1 : -1
  return { leave: `translateX(${-dir * 2.5}em)`, arrive: `translateX(${dir * 2.5}em)` }
}

/** The most entries moved at once: what a window shows of a roster, and no more. */
export const MOST_MOVED = 48

/** Console and Score list the same sessions, each entry carrying `data-session`: the roster's
 *  entries slide onto their lines, and back. For each session both views show, where its entry
 *  in the arriving view starts from (`x`, `y`, from its own place) so that it leaves from where
 *  the other view had it. An entry out of sight on either side does not move. */
export function slides(from: ReadonlyMap<string, Box>, to: ReadonlyMap<string, Box>, room: Box): { id: string; x: number; y: number }[] {
  const seen = (b: Box) => b.width > 0 && b.height > 0 && b.top + b.height > room.top && b.top < room.top + room.height && b.left + b.width > room.left && b.left < room.left + room.width
  const out: { id: string; x: number; y: number }[] = []
  for (const [id, there] of to) {
    const here = from.get(id)
    if (!here || !seen(here) || !seen(there)) continue
    const x = here.left - there.left
    const y = here.top - there.top
    if (Math.abs(x) < 1 && Math.abs(y) < 1) continue
    out.push({ id, x, y })
    if (out.length === MOST_MOVED) break
  }
  return out
}

/** The roster's entries, and the cards of Score's lines. */
const ENTRIES = '[data-roster] [data-session], [data-score-row] [data-session]'

/** Each session's entry in a layer, by its id: the first one the layer draws. */
export function entriesOf(layer: ParentNode): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>()
  for (const el of layer.querySelectorAll<HTMLElement>(ENTRIES)) {
    const id = el.dataset.session
    if (id && !out.has(id)) out.set(id, el)
  }
  return out
}

const boxesOf = (entries: Map<string, HTMLElement>): Map<string, Box> => new Map([...entries].map(([id, el]) => [id, el.getBoundingClientRect()]))

/** Sets each shared entry of the arriving view going from where the leaving view had it.
 *  True when any moved. */
function slideEntries(out: HTMLElement, into: HTMLElement): boolean {
  const arriving = entriesOf(into)
  const list = slides(boxesOf(entriesOf(out)), boxesOf(arriving), into.getBoundingClientRect())
  for (const m of list) {
    const el = arriving.get(m.id)
    // jsdom has no Web Animations: there the entry is simply where it belongs.
    if (typeof el?.animate !== 'function') continue
    el.animate([{ transform: `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: MOVE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
  }
  return list.length > 0
}

/** Reads the two layers as they stand, before either moves, and sets where each is going. */
function setContinuity(out: HTMLElement, into: HTMLElement, from: View, to: View): void {
  const scene = from === 'orbit' ? out : to === 'orbit' ? into : null
  const map = scene ? (scene === out ? into : out).querySelector('[data-orbit-map]') : null
  // Between Console and Score the entries themselves carry the change: each slides from its
  // place in one list to its place in the other, and the two views stay where they are.
  if (!scene && slideEntries(out, into)) {
    out.style.setProperty('--frame-to', 'none')
    into.style.setProperty('--frame-from', 'none')
    return
  }
  const { leave, arrive } = continuity(from, to, scene?.getBoundingClientRect() ?? null, map?.getBoundingClientRect() ?? null)
  out.style.setProperty('--frame-to', leave)
  into.style.setProperty('--frame-from', arrive)
}

/** The three views, one at a time. While the view changes the one left stays for a moment,
 *  inert, so the change reads as one movement and the selection is seen to carry over. */
function Views() {
  const view = useRoute((r) => r.view)
  const [was, setWas] = useState(view)
  const [leaving, setLeaving] = useState<View | null>(null)
  const layers = useRef<Partial<Record<View, HTMLDivElement | null>>>({})

  if (was !== view) {
    setWas(view)
    // Nothing moves when motion is off: the new view is simply there.
    setLeaving(still() ? null : was)
  }

  useLayoutEffect(() => {
    if (!leaving || leaving === view) return
    const out = layers.current[leaving]
    const into = layers.current[view]
    if (out && into) {
      // Measured before either moves, then both are set going.
      setContinuity(out, into, leaving, view)
      out.dataset.phase = 'out'
      into.dataset.phase = 'in'
    }
    const done = setTimeout(() => setLeaving(null), MOVE_MS)
    return () => {
      clearTimeout(done)
      if (into) delete into.dataset.phase
      if (out) delete out.dataset.phase
    }
  }, [leaving, view])

  return (
    <>
      {ORDER.filter((v) => v === view || v === leaving).map((v) => (
        <div
          key={v}
          ref={(el) => {
            layers.current[v] = el
          }}
          className="frame-view"
          data-layer={v}
          data-leaving={v !== view || undefined}
          inert={v !== view}
          aria-hidden={v !== view || undefined}
        >
          {v === 'orbit' ? <OrbitView /> : v === 'console' ? <ConsoleLayout /> : <ScoreView />}
        </div>
      ))}
    </>
  )
}

/** Alt, on its own. On Windows a window that is handed an Alt nobody took goes into its menu
 *  mode when Alt is released: the next key is the menu's, not the terminal's, and it is lost
 *  (seen in a debug build, 2026-11-10: Alt pressed and released inside a hosted shell, then `x`,
 *  and no `x` at the prompt). The fleet is reached with Alt from inside a terminal, so Alt alone
 *  is pressed all the time here, on the way to a chord or instead of one. The frame says the key
 *  is taken, and does nothing else with it: it still reaches whoever listens (dictation's hold
 *  ends on its release). */
export function bareAlt(e: Pick<KeyboardEvent, 'key' | 'preventDefault'>): void {
  if (e.key === 'Alt') e.preventDefault()
}

export function Frame() {
  const view = useRoute((r) => r.view)
  const reduced = useReduced()
  const james = useJames()
  const root = useRef<HTMLDivElement>(null)
  // The boot sequence: decided once, at launch, from where the app opens.
  const [boot, setBoot] = useState<BootPhase | null>(() => (bootsNow(routeStore.getState().route, still()) ? 'playing' : null))
  const onBoot = useCallback((next: BootPhase | null) => setBoot(next), [])
  // The terminals the app holds that are no session: listed after the sessions, walked after them.
  const hosted = useHosted()
  const held = useRef(hosted)
  held.current = hosted
  /** The caret is in a terminal or a text field: the fleet's keys need Alt there. */
  const [typing, setTyping] = useState(false)

  useEffect(() => startWorld(), [])
  useEffect(() => (root.current ? watchAway(root.current) : undefined), [])
  useEffect(() => (worldSource() === 'live' ? startRuntime() : undefined), [])

  useEffect(() => {
    const fleet: Fleet = {
      world: () => worldStore.getState().world,
      route: () => routeStore.getState().route,
      recent: () => routeStore.getState().recent,
      order: () => [...rosterShown(), ...plainTerminals(worldStore.getState().world, held.current)],
      has: (id) => !!sessionOf(worldStore.getState().world, id) || held.current.some((h) => h.id === id),
      go,
      now: () => Date.now(),
      nextPending,
      answerArmed,
      replyArmed,
      focusTerminal: () => focusTerminal(root.current, focusStage),
      leaveField: () => {
        // A field that already handed the caret on is left alone: the stage's box gives it to
        // the stage, so the stage's own keys go on working.
        const at = document.activeElement
        if (at instanceof HTMLElement && whereOf(at) === 'field') at.blur()
      },
      openCommand: () => openCommand(),
      escapeCommand,
      sheet: { isOpen: () => sheetStore.getState().open, set: (open) => sheetStore.setState({ open }) },
      openMenu: (of) => menuByKey(root.current, of, held.current),
      back: createBack(),
    }
    const on = (down: boolean) => (e: KeyboardEvent) => {
      if (e.isComposing) return
      const target = e.target instanceof Element ? e.target : null
      // Only what is typed at the frame: not at a window or an overlay drawn outside it.
      if (target && target !== document.body && target !== document.documentElement && !root.current?.contains(target)) return
      const where = whereOf(target)
      // A terminal keeps its keys from going any further, so its Alt chords are read on the way
      // down. Everywhere else the frame reads a key last: a view that took it (and said so with
      // preventDefault) keeps it.
      if ((where === 'terminal') !== down) return
      if (!down && e.defaultPrevented) return
      if (press(e, where, fleet)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const down = on(true)
    const up = on(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keydown', up)
    window.addEventListener('keydown', bareAlt, true)
    window.addEventListener('keyup', bareAlt, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keydown', up)
      window.removeEventListener('keydown', bareAlt, true)
      window.removeEventListener('keyup', bareAlt, true)
    }
  }, [])

  useEffect(() => {
    const typed = (el: EventTarget | null) => {
      const where = whereOf(el)
      return where === 'terminal' || where === 'field'
    }
    const focusIn = (e: FocusEvent) => setTyping(typed(e.target))
    const focusOut = (e: FocusEvent) => setTyping(typed(e.relatedTarget))
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    return () => {
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
    }
  }, [])

  return (
    <div ref={root} className="mn" data-view={view} data-world={worldSource()} data-motion={reduced ? 'reduced' : undefined} data-boot={boot ?? undefined} data-james={james ? true : undefined}>
      <Starfield />
      <div className="frame">
        <TopBar />
        <PanelBar />
        <Unread />
        <main className="frame-main">
          <Views />
          {/* The clip of the launch, over Orbit until Orbit has opened out of it. */}
          {boot && <Boot phase={boot} onPhase={onBoot} />}
          {/* The open panel, over the views and under the top bar and the foot. */}
          <Panels />
        </main>
        <footer className="frame-foot">
          <CommandLine />
          <KeyHints alt={typing} />
        </footer>
      </div>
      <KeySheet />
      {/* The one menu, over everything: on a session, a project's name, a held terminal. */}
      <Menu />
    </div>
  )
}

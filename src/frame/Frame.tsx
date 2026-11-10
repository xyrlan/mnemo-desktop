// The frame: the top bar, the layout of each view, the fleet-wide keys, the key sheet and the
// command line (docs/superpowers/specs/2026-11-10-recreation-design.md, "The frame"). Every
// view is another piece's; the frame gives each its room and keeps the selection between them.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@fontsource-variable/jura'
import '../ds/tokens.css'
import './frame.css'
import { CommandLine, escapeCommand, openCommand } from '../command'
import { Starfield } from '../ds'
import { Instruments } from '../instruments'
import { OrbitView } from '../orbit'
import { nextPending } from '../pending'
import { Roster } from '../roster'
import { startRuntime } from '../runtime'
import { ScoreView } from '../score'
import { Stage } from '../stage'
import { go, routeStore, useRoute, type View } from '../world/route'
import { startWorld } from '../world/start'
import { rosterOrder, sessionOf, useWorld, worldSource, worldStore } from '../world/store'
import { KeyHints, KeySheet, sheetStore } from './KeySheet'
import { createBack, focusTerminal, press, whereOf, type Fleet } from './keys'
import { still, useReduced } from './motion'
import { answerArmed, replyArmed } from './pieces'
import { TopBar, Unread } from './TopBar'

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

  // Console is never without a session on stage: with none chosen, the first in roster order.
  useEffect(() => {
    if (known || !sessions) return
    const first = rosterOrder(worldStore.getState().world)[0]
    if (first) go({ session: first.id })
  }, [known, sessions])

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

/** Reads the two layers as they stand, before either moves, and sets where each is going. */
function setContinuity(out: HTMLElement, into: HTMLElement, from: View, to: View): void {
  const scene = from === 'orbit' ? out : to === 'orbit' ? into : null
  const map = scene ? (scene === out ? into : out).querySelector('[data-orbit-map]') : null
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

export function Frame() {
  const view = useRoute((r) => r.view)
  const reduced = useReduced()
  const root = useRef<HTMLDivElement>(null)
  /** The caret is in a terminal or a text field: the fleet's keys need Alt there. */
  const [typing, setTyping] = useState(false)

  useEffect(() => startWorld(), [])
  useEffect(() => (worldSource() === 'live' ? startRuntime() : undefined), [])

  useEffect(() => {
    const fleet: Fleet = {
      world: () => worldStore.getState().world,
      route: () => routeStore.getState().route,
      recent: () => routeStore.getState().recent,
      go,
      now: () => Date.now(),
      nextPending,
      answerArmed,
      replyArmed,
      focusTerminal: () => focusTerminal(root.current),
      leaveField: () => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined),
      openCommand: () => openCommand(),
      escapeCommand,
      sheet: { isOpen: () => sheetStore.getState().open, set: (open) => sheetStore.setState({ open }) },
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
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keydown', up)
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
    <div ref={root} className="mn" data-view={view} data-world={worldSource()} data-motion={reduced ? 'reduced' : undefined}>
      <Starfield />
      <div className="frame">
        <TopBar />
        <Unread />
        <main className="frame-main">
          <Views />
        </main>
        <footer className="frame-foot">
          <CommandLine />
          <KeyHints alt={typing} />
        </footer>
      </div>
      <KeySheet />
    </div>
  )
}

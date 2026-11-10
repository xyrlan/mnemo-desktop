// The boot sequence (docs/superpowers/specs/2026-11-10-recreation-swap.md): at launch the
// generated clip of the lattice assembling plays once, where Orbit's lattice stands, and Orbit
// opens out of its last frame. Any key or click skips it; so does reduced motion, and a launch
// that returns to anything but Orbit. It never keeps what waits from being seen for longer than
// the clip's four seconds: the top bar and the foot are there throughout, Orbit opens under the
// clip's last moments, and a clip that stalls or will not load is left at once.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import poster from '../ds/art/boot-last.jpg'
import mp4 from '../ds/art/boot.mp4'
import webm from '../ds/art/boot.webm'
import type { Route } from '../world/route'

/** The clip's length, and the longest a launch waits for it. */
export const BOOT_MS = 4000
/** Orbit opens under the clip's last moments, so it is whole when the clip ends. */
export const OPEN_MS = 700
/** The clip's last frame gives way to the lattice drawn live. */
export const LEAVE_MS = 320

/** playing: the clip alone. opening: Orbit opens under it. leaving: the clip fades from over
 *  the live lattice. */
export type BootPhase = 'playing' | 'opening' | 'leaving'

const PLAYED = 'mnemo.booted'
const OFF = 'mnemo.boot'

/** Whether this launch plays the clip. `played`: this run of the app already did (a reload is
 *  not a launch). `off`: `localStorage['mnemo.boot'] = '0'`, which the preview harness sets so a
 *  picture of a URL is never a picture of the clip. */
export function boots(route: Pick<Route, 'view'>, o: { still: boolean; played: boolean; off: boolean }): boolean {
  return route.view === 'orbit' && !o.still && !o.played && !o.off
}

const read = (store: () => Storage, key: string): string | null => {
  try {
    return store().getItem(key)
  } catch {
    return null
  }
}

/** `boots`, with what this page knows. */
export function bootsNow(route: Pick<Route, 'view'>, still: boolean): boolean {
  return boots(route, { still, played: read(() => sessionStorage, PLAYED) === '1', off: read(() => localStorage, OFF) === '0' })
}

function markPlayed(): void {
  try {
    sessionStorage.setItem(PLAYED, '1')
  } catch {
    // storage refused: a reload plays it again
  }
}

type Box = { left: number; top: number; size: number }

/** Where the clip stands: over Orbit's lattice, at its size; with no lattice to be found, in
 *  the middle of the room it has. */
export function placeOf(main: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, core: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null): Box {
  if (core && core.width > 0 && core.height > 0) {
    const size = Math.max(core.width, core.height)
    return { left: core.left - main.left + core.width / 2, top: core.top - main.top + core.height / 2, size }
  }
  return { left: main.width / 2, top: main.height / 2, size: Math.min(main.width, main.height) * 0.24 }
}

/** The clip, over the views. `phase` is the frame's (its root carries it, so Orbit can answer in
 *  CSS); `onPhase(null)` is the end. */
export function Boot({ phase, onPhase }: { phase: BootPhase; onPhase: (next: BootPhase | null) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Box | null>(null)
  const at = useRef(phase)
  at.current = phase

  const leave = useCallback(() => {
    if (at.current !== 'leaving') onPhase('leaving')
  }, [onPhase])

  useEffect(() => markPlayed(), [])

  // The clock: Orbit opens under the clip's end, and nothing waits past the clip's length.
  useEffect(() => {
    const open = setTimeout(() => at.current === 'playing' && onPhase('opening'), BOOT_MS - OPEN_MS)
    const end = setTimeout(leave, BOOT_MS)
    return () => {
      clearTimeout(open)
      clearTimeout(end)
    }
  }, [leave, onPhase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const gone = setTimeout(() => onPhase(null), LEAVE_MS)
    return () => clearTimeout(gone)
  }, [phase, onPhase])

  // Any key or click skips it, and still does what it would have done: nothing is swallowed.
  useEffect(() => {
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && ['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return
      leave()
    }
    window.addEventListener('keydown', skip, true)
    window.addEventListener('pointerdown', skip, true)
    return () => {
      window.removeEventListener('keydown', skip, true)
      window.removeEventListener('pointerdown', skip, true)
    }
  }, [leave])

  // Over Orbit's lattice, wherever the window puts it.
  useLayoutEffect(() => {
    const main = root.current?.parentElement
    if (!main) return
    const measure = () => {
      const core = main.querySelector('[data-layer="orbit"] .orbit-core-in')
      const next = placeOf(main.getBoundingClientRect(), core?.getBoundingClientRect() ?? null)
      setPlace((was) => (was && was.left === next.left && was.top === next.top && was.size === next.size ? was : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(main)
    return () => watch.disconnect()
  }, [])

  const style = place ? ({ left: place.left, top: place.top, width: place.size, height: place.size } as CSSProperties) : undefined
  return (
    <div ref={root} className="frame-boot" data-frame-boot={phase} aria-hidden="true">
      {place && (
        <div className="frame-boot-clip" style={style}>
          {/* A clip that cannot be played is left at once: a source that cannot be read says so
              to the clip (React hands a source's error on to the video that holds it). */}
          <video autoPlay muted playsInline preload="auto" poster={poster} onEnded={leave} onError={leave}>
            <source src={webm} type="video/webm" />
            <source src={mp4} type="video/mp4" />
          </video>
        </div>
      )}
    </div>
  )
}

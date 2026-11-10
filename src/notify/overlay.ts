// What an overlay needs to wear the new identity (docs/superpowers/specs/2026-11-10-recreation-front.md,
// "The overlays"). James's panel, the notification stack and the dictation indicator are drawn
// over whatever front is mounted, outside the frame's root, so each is a `.mn` root of its own:
// the class brings the tokens, the reset and the three root sizes (`src/ds/tokens.css`), and the
// overlay's own sheet puts it where it stands (`.mn.<overlay>` beats `.mn`'s place and ground).
//
// The frame's motion switch is `data-motion="reduced"` on the frame's root, which an overlay is
// not inside. It is read off that root here, so an overlay stills with the views.

import { useSyncExternalStore } from 'react'
import '@fontsource-variable/jura'
import '../ds/tokens.css'

/** The frame's root, and only it: an overlay's own root has no `data-view`. */
const FRAME_STILLED = '.mn[data-view][data-motion="reduced"]'
const SYSTEM = '(prefers-reduced-motion: reduce)'

/** Whether the frame's motion switch says nothing may move. False with no frame (the ship). */
export function frameStilled(): boolean {
  return typeof document !== 'undefined' && document.querySelector(FRAME_STILLED) !== null
}

function systemStilled(): boolean {
  try {
    return window.matchMedia(SYSTEM).matches
  } catch {
    return false
  }
}

/** Whether anything may move right now: the frame's switch, or the system, says no. */
export const stilled = (): boolean => frameStilled() || systemStilled()

/** Hears the switch and the system's preference change. The switch is an attribute, so only
 *  `data-motion` changing anywhere wakes this: no timer, and nothing while nothing changes. */
function hear(fn: () => void): () => void {
  const watch = typeof MutationObserver === 'undefined' ? null : new MutationObserver(fn)
  watch?.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-motion'] })
  let media: MediaQueryList | null = null
  try {
    media = window.matchMedia(SYSTEM)
    media.addEventListener('change', fn)
  } catch {
    media = null
  }
  return () => {
    watch?.disconnect()
    media?.removeEventListener('change', fn)
  }
}

/** The frame's switch, for an overlay's own root: `data-motion={useFrameStilled() ? 'reduced' : undefined}`,
 *  which is what `tokens.css` stills a root's descendants on. */
export const useFrameStilled = (): boolean => useSyncExternalStore(hear, frameStilled, () => false)

/** `stilled`, heard: for motion a stylesheet cannot still (a video that plays). */
export const useStilled = (): boolean => useSyncExternalStore(hear, stilled, () => false)

/** What an overlay's root carries: the identity's class beside its own, and the frame's switch. */
export function useOverlayRoot(name: string): { className: string; 'data-motion': 'reduced' | undefined } {
  return { className: `mn ${name}`, 'data-motion': useFrameStilled() ? 'reduced' : undefined }
}

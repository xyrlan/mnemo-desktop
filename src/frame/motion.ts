// The motion switch: one setting stills everything (`data-motion="reduced"` on the frame's
// root, which `src/ds/tokens.css` and every piece's own animation honour). It is kept across
// launches. The system's own preference stills things too, whatever this says.

import { create } from 'zustand'

const KEY = 'mnemo.motion'

const kept = (): boolean => {
  try {
    return localStorage.getItem(KEY) === 'reduced'
  } catch {
    return false
  }
}

export const motionStore = create<{ reduced: boolean }>(() => ({ reduced: kept() }))

export function setReduced(reduced: boolean): void {
  motionStore.setState({ reduced })
  try {
    localStorage.setItem(KEY, reduced ? 'reduced' : 'full')
  } catch {
    // storage refused: the switch holds for this run
  }
}

export const useReduced = (): boolean => motionStore((s) => s.reduced)

/** Whether anything may move right now: the switch, or the system, says no. */
export function still(): boolean {
  if (motionStore.getState().reduced) return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

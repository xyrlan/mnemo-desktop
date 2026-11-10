// James as the rest of the app reaches him: the one store of the app run, and what his presence
// says of it. `src/jarvis/view.tsx` runs the loop over this store; the top bar's `JamesPresence`
// reads it with no props, so it is kept here and not in the view.

import { createStore } from 'zustand/vanilla'
import { LOOK_WORD } from '../orb/show'
import { approvals, createJarvisStore, type JarvisState } from '../store'

/** The store James's loop writes and his panel and presence read. */
export const jamesStore = createJarvisStore()

/** What James is doing, as his presence shows it. `rest`: nothing. `waiting`: he answered and
 *  still listens for a follow-up. `error`: the last thing he said was that something failed. */
export type PresenceState = 'rest' | 'listening' | 'thinking' | 'speaking' | 'waiting' | 'error'

export type Presence = {
  state: PresenceState
  /** The parents that wait on an approval only the maintainer can give. */
  approvals: number
}

/** The word beside his name; none at rest. */
export const PRESENCE_WORD: Record<PresenceState, string> = { rest: '', ...LOOK_WORD, error: 'failed' }

/** James listens, thinks or speaks: his orb is alive. At rest, waiting or failed it is still. */
export const alive = (state: PresenceState): boolean => state === 'listening' || state === 'thinking' || state === 'speaking'

/** What the presence shows of the store. The voice wins while it is on; then a request being
 *  worked on; then a failure, until something is said after it. */
export function presenceOf(s: Pick<JarvisState, 'voice' | 'busy' | 'lines' | 'parents'>): Presence {
  const waiting = approvals(s).length
  const of = (state: PresenceState): Presence => ({ state, approvals: waiting })
  switch (s.voice) {
    case 'listening':
      return of('listening')
    case 'transcribing':
      return of('thinking')
    case 'speaking':
      return of('speaking')
    case 'waiting':
      return of('waiting')
    case 'idle': {
      if (s.busy) return of('thinking')
      const last = s.lines[s.lines.length - 1]
      return of(last?.who === 'note' && last.error ? 'error' : 'rest')
    }
  }
}

/** How many `JamesPresence` are on screen. While there is one (the frame's top bar), the panel
 *  draws no way in of its own; with none (the ship, or a frame that has not placed him yet), it
 *  docks one in the corner, so James is never out of reach. */
export const presenceHosts = createStore<{ hosts: number }>(() => ({ hosts: 0 }))

/** Counts a presence in. Returns the way to count it out. */
export function hostPresence(): () => void {
  presenceHosts.setState((s) => ({ hosts: s.hosts + 1 }))
  let counted = true
  return () => {
    if (!counted) return
    counted = false
    presenceHosts.setState((s) => ({ hosts: s.hosts - 1 }))
  }
}

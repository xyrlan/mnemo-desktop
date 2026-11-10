// James's place in the top bar. `JamesPresence` is the overlays piece's
// (`src/jarvis/panel/`): his state, and the way into his panel. The app hands it over at start
// (`./view.tsx`); the top bar draws whatever is here, and nothing while nothing is. Kept apart
// from the bar so a test of the frame loads none of James.

import type { ComponentType } from 'react'
import { create } from 'zustand'

export const jamesStore = create<{ Presence: ComponentType | null }>(() => ({ Presence: null }))

/** Puts James in the top bar (or takes him out, with null). */
export const setJames = (Presence: ComponentType | null): void => jamesStore.setState({ Presence })

/** What stands in the top bar for James, if anything does. */
export const useJames = (): ComponentType | null => jamesStore((s) => s.Presence)

/** The presence a module of `src/jarvis/panel/` exports, or null when it exports none (the
 *  overlays piece is not on this branch): `found` is what a glob of that module came to. */
export function presenceIn(found: Record<string, unknown>): ComponentType | null {
  for (const mod of Object.values(found)) {
    const Presence = (mod as { JamesPresence?: unknown } | null)?.JamesPresence
    if (typeof Presence === 'function') return Presence as ComponentType
  }
  return null
}

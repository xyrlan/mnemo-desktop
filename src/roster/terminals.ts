// The terminals the app holds that are no session of the world: a plain shell, a saved command,
// a session so new that the world does not list it yet. The roster lists them after the
// sessions and the stage draws one with a head that says what it is
// (docs/superpowers/specs/2026-11-10-recreation-swap.md, "A terminal that is not a session").

import type { Hosted } from '../runtime'
import { sessionOf } from '../world/store'
import type { World } from '../world/types'

/** The held terminals no session of the world accounts for, in the order they were opened. */
export function plainTerminals(world: World, hosted: readonly Hosted[]): Hosted[] {
  return hosted.filter((h) => !sessionOf(world, h.id) && !(h.sessionId && sessionOf(world, h.sessionId)))
}

/** The held terminal `id` names, when it is one of those. */
export function terminalOf(world: World, hosted: readonly Hosted[], id: string | null | undefined): Hosted | undefined {
  return id ? plainTerminals(world, hosted).find((h) => h.id === id) : undefined
}

/** What a terminal is, in a word: the app started it as a session whose id the world has not
 *  learnt yet, or it is a shell (or a command run in one). */
export const terminalWord = (h: Pick<Hosted, 'kind' | 'sessionId'>): string => (h.kind !== 'session' || h.sessionId ? 'session, not listed yet' : 'shell')

/** What to call it: its own label, else the folder it runs in, else what it is. */
export function terminalName(h: Pick<Hosted, 'label' | 'cwd' | 'kind' | 'sessionId'>): string {
  const label = h.label.trim()
  if (label) return label
  const folder = (h.cwd ?? '').split(/[\\/]/).filter(Boolean).pop()
  return folder ?? terminalWord(h)
}

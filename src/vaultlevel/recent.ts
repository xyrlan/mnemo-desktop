/** The square's trail: what kinds of thing mnemo did lately, not a tick-by-tick log. Pure. */
import { SCENES, type Scene } from '../avatar/scenes'
import type { PulseKind } from '../pulse/types'

export type Recent = { kind: PulseKind; count: number }

/** The last `n` runs of `log`, oldest first. Consecutive pulses of one kind are one run with a
 *  count: `tool` can fire many times a minute, and five identical dots say less than five kinds.
 *  Reads the whole log and ignores `pane` — the square reports on mnemo, not on a pane. */
export function recentPulses(log: readonly { event: { kind: PulseKind } }[], n: number): Recent[] {
  const out: Recent[] = []
  for (let i = log.length - 1; i >= 0; i--) {
    const kind = log[i].event.kind
    const head = out[0]
    if (head?.kind === kind) head.count++
    else if (out.length < n) out.unshift({ kind, count: 1 })
    else break
  }
  return out
}

/** A dot's colour is its scene's, so a scene that changes tone changes its dot. */
export const toneOfKind = (kind: PulseKind): Scene['tone'] => SCENES[kind]?.tone ?? 'muted'

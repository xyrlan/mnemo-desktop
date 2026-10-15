import { basename } from '../path/path'
import type { ChildSession } from '../mission/types'
import type { PulseEvent, PulseKind } from '../pulse/types'
import { ACCESSORIES, type RobotClass } from './ship-types'

/** Who a child is on the ship, from its row alone: its chassis, its accessory, its tag, and the
 *  rules mnemo put in front of it. `buildShip` reads them; they came over from v1. */

/** The chassis from the model: any spelling that names the family (`opus[1m]`,
 *  `claude-haiku-4-5`). No model, or one of no known family, is `unknown`. */
export function classOf(model: string | null | undefined): RobotClass {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'mech'
  if (m.includes('sonnet')) return 'droid'
  if (m.includes('haiku')) return 'drone'
  return 'unknown'
}

/** The identity accessory, seeded from the short id (FNV-1a): the same child wears the same one
 *  every time it is drawn. */
export function accessoryOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % ACCESSORIES
}

/** The child's tag: `#643` from a `<repo>-wt-643[-…]` worktree, else its contract piece, else its
 *  short id. */
export function labelOf(c: Pick<ChildSession, 'id' | 'cwd' | 'branch'>, piece: string | null): string {
  const issue = c.cwd ? /-wt-(\d+)(?:-|$)/.exec(basename(c.cwd)) : null
  if (issue) return `#${issue[1]}`
  const fromBranch = c.branch ? /^feat\/[^/]+\/([^/]+)$/.exec(c.branch)?.[1] : undefined
  return piece ?? fromBranch ?? c.id
}

/** A child stopped by the account's limit: mnemo's sentence for it (`rate limited — wait and
 *  retry`, `stalls.py`), or Claude Code's own "You've hit your session limit". A billing cap
 *  (`usage limit reached — check plan`) needs a person, so it is not one. */
export function isRateLimited(c: Pick<ChildSession, 'needs' | 'detail'>): boolean {
  const said = `${c.needs ?? ''}\n${c.detail}`
  return /rate[ -]?limit/i.test(said) || /hit your (?:\w+ )?limit/i.test(said)
}

/** The kinds whose slugs mnemo put in front of the agent. A `tool` row's slugs are what the agent
 *  asked for, not what it was given. */
const INJECTED: ReadonlySet<PulseKind> = new Set(['reflex', 'catchup', 'enrich'])

/** The rule slugs mnemo injected into session `sessionId`, newest first, each once. */
export function injectedRules(events: PulseEvent[], sessionId: string): string[] {
  const mine = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.session_id === sessionId && INJECTED.has(e.kind))
    // Newest first; of two at one time, the one logged later.
    .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
  const out: string[] = []
  for (const { e } of mine) for (const s of e.slugs) if (!out.includes(s)) out.push(s)
  return out
}

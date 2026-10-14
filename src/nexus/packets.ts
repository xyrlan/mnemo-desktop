import type { PulseEvent } from '../pulse/types'
import type { Packet, World } from './types'

/** mnemo's memory events as packets between archives and agents (spec Q22, Q23): attributed to a
 *  robot or nexus by `session_id` (or, for `enrich`, by the file's worktree), coalesced per agent.
 *  Pure, and the same event keeps the same packet id across calls.
 *
 *  Stub until the `memory` piece lands: no packets. */
export function packetsFrom(_events: PulseEvent[], _world: World, _now: number): Packet[] {
  return []
}

/** The rule slugs mnemo put in front of `sessionId`'s agent, newest first, without repeats: what
 *  the hover card lists.
 *
 *  Stub until the `memory` piece lands. */
export function injectedRules(_events: PulseEvent[], _sessionId: string): string[] {
  return []
}

import type { LogEvent, Ship } from './ship-types'

/** The milestones between two ships, for the ship's log; `prev` is null on the first build. Stub
 *  until the `ship` piece lands. */
export function logEvents(_prev: Ship | null, _next: Ship, _now: number): LogEvent[] {
  return []
}

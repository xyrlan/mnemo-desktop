import type { Parsed, Ship } from '../ship-types'

/** A line typed at the fleet prompt, read against the ship. Stub until the `command` piece lands. */
export function parseCommand(_line: string, _ship: Ship): Parsed {
  return { error: 'the fleet prompt is not built yet' }
}

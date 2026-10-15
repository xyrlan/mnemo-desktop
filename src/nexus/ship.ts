import type { Ship, ShipInput } from './ship-types'

/** The fleet as a ship (spec "What it is", "What each figure is computed from"): pure, and the same
 *  input gives the same ship. Stub until the `ship` piece lands. */
export function buildShip(input: ShipInput): Ship {
  return { bridge: { exceptions: [], blocked: [] }, decks: [], docks: [], counts: { working: 0, need: 0, ready: 0 }, rate: input.feed?.rate ?? null, at: input.now }
}

import type { Captain, Deck, Dock, Ship, ShipRobot } from '../ship-types'

/** Lookups on a ship the command piece shares: what a typed name, a selection or an action's id
 *  points at. The ship is the one the view built; nothing here changes it. */

/** Every robot on the ship: the blocked ones on the bridge, then each deck's rooms. */
export const robotsOf = (ship: Ship): ShipRobot[] => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]

/** Every captain on the ship: each deck's, its quiet ones, then the docks'. */
export const captainsOf = (ship: Ship): Captain[] => [...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)]

export const robotById = (ship: Ship, id: string): ShipRobot | undefined => robotsOf(ship).find((r) => r.id === id)

export const captainById = (ship: Ship, id: string): Captain | undefined => captainsOf(ship).find((c) => c.id === id)

const holds = (d: Deck, r: ShipRobot) => [d.flight, d.hangar, d.stranded].some((room) => room.some((x) => x.id === r.id))
const crews = (d: Deck | Dock, captainId: string) => [...d.captains, ...('quiet' in d ? d.quiet : [])].some((c) => c.id === captainId)

/** The deck or dock a robot belongs to: the one it stands in, else its captain's. A blocked robot
 *  stands on the bridge, so its captain says. */
export function placeOf(ship: Ship, r: ShipRobot): Deck | Dock | undefined {
  return ship.decks.find((d) => holds(d, r)) ?? ship.decks.find((d) => crews(d, r.captainId)) ?? ship.docks.find((d) => crews(d, r.captainId))
}

/** The last segment of a path, on either separator. */
export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** The repo a robot's commands run in: its deck's root, else its own worktree. */
export const rootOf = (ship: Ship, r: ShipRobot): string => placeOf(ship, r)?.root ?? r.child.cwd

/** The repo's name a robot belongs to, for breadcrumbs. */
export const repoNameOf = (ship: Ship, r: ShipRobot): string => placeOf(ship, r)?.name ?? baseName(r.child.cwd)

/** Every repo on the ship, decks then docks. */
export const reposOf = (ship: Ship): { root: string; name: string }[] => [...ship.decks, ...ship.docks].map(({ root, name }) => ({ root, name }))

/** A captain as the ship writes it: `◆ fleet-lead`. */
export const captainLabel = (c: Captain) => `${c.emblem} ${c.name}`

/** A robot's PR merges from here only while it is open and its CI is green at this moment. */
export const isGreen = (r: ShipRobot) => r.ci === 'green' && r.pr !== null && r.fate?.state !== 'MERGED' && r.fate?.state !== 'CLOSED'

/** A child still running: it can be stopped and messaged. */
export const isRunning = (r: ShipRobot) => r.state === 'working' || r.state === 'idle' || r.state === 'need'

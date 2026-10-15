import type { ChildSession, Pr } from '../../mission/types'
import { basename, dirname, norm, samePath, within } from '../../path/path'
import type { Captain, Ship, ShipRobot } from '../ship-types'

/** Lookups on a ship the command piece shares: what a typed name, a selection or an action's id
 *  points at. The ship is the one the view built; nothing here changes it. */

/** Every robot on the ship: the blocked ones on the bridge, then each deck's rooms. */
export const robotsOf = (ship: Ship): ShipRobot[] => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]

/** Every captain on the ship: each deck's, its quiet ones, then the docks'. */
export const captainsOf = (ship: Ship): Captain[] => [...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)]

export const robotById = (ship: Ship, id: string): ShipRobot | undefined => robotsOf(ship).find((r) => r.id === id)

export const captainById = (ship: Ship, id: string): Captain | undefined => captainsOf(ship).find((c) => c.id === id)

/** The repo a child works in, from its own worktree, never from the deck it stands on: a robot
 *  stands on its captain's deck, which can be another repo. A worktree inside a repo on the ship
 *  (`<repo>/.claude/worktrees/x`) is that repo; a `<repo>-wt-<name>` folder folds into its sibling
 *  `<repo>`, one the ship knows first; anything else is the worktree itself. */
export function repoRootOf(ship: Ship, child: ChildSession): string {
  const known = reposOf(ship).map((r) => r.root)
  const inside = known.filter((k) => within(child.cwd, k)).sort((a, b) => norm(b).length - norm(a).length)[0]
  if (inside) return inside
  const name = basename(child.cwd)
  const dir = dirname(child.cwd)
  const bases: string[] = []
  for (let i = name.indexOf('-wt-'); i >= 0; i = name.indexOf('-wt-', i + 1)) if (i > 0 && i + 4 < name.length) bases.push(`${dir.endsWith('/') ? dir : `${dir}/`}${name.slice(0, i)}`)
  if (!bases.length) return child.cwd
  return known.find((k) => bases.some((b) => samePath(b, k))) ?? bases[0]
}

/** The repo's name a robot belongs to, for breadcrumbs. */
export function repoNameOf(ship: Ship, r: ShipRobot): string {
  const root = repoRootOf(ship, r.child)
  return reposOf(ship).find((x) => samePath(x.root, root))?.name ?? basename(root)
}

/** `owner/name` of a GitHub PR url, or null for any other url. */
export function prRepo(url: string): { owner: string; name: string } | null {
  const m = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/i.exec(url)
  return m ? { owner: m[1], name: m[2] } : null
}

/** Why `pr` cannot be acted on from `root`: its url names another repo. Null when they agree,
 *  or when the url says nothing either way. */
export function otherRepo(root: string, pr: Pick<Pr, 'number' | 'url'>): string | null {
  const repo = prRepo(pr.url)
  if (!repo || repo.name.toLowerCase() === basename(root).toLowerCase()) return null
  return `PR #${pr.number} is in ${repo.owner}/${repo.name}, not in ${basename(root)}`
}

/** Every repo on the ship, decks then docks. */
export const reposOf = (ship: Ship): { root: string; name: string }[] => [...ship.decks, ...ship.docks].map(({ root, name }) => ({ root, name }))

/** A captain as the ship writes it: `◆ fleet-lead`. */
export const captainLabel = (c: Captain) => `${c.emblem} ${c.name}`

/** Green, as the ship says it (`ci === 'green'`), with a PR to merge. A PR no check ran on is never
 *  green, whatever else says so: nothing says it passed. */
export const isGreen = (r: ShipRobot) => r.ci === 'green' && r.pr !== null && !(r.fate && r.fate.checks.length === 0)

/** A child still running: it can be stopped and messaged. */
export const isRunning = (r: ShipRobot) => r.state === 'working' || r.state === 'idle' || r.state === 'need'

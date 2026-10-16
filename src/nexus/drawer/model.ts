import type { AgentState, RepoNode } from '../../fleet/types'
import { basename, norm, within } from '../../path/path'
import type { SessionRef } from '../../session/host'
import type { Captain, Deck, Dock, Feed, Ship, ShipRobot } from '../ship-types'
import { SHIP_SPRITES, SPRITES, type SpriteSheet } from '../sprites'
import type { DrawerTab } from '../store'

/** What the drawer reads off the ship: which figure an id is, how its session is shown, and what
 *  its tab and header say. */

export type Figure = { kind: 'robot'; robot: ShipRobot; deck: Deck | null } | { kind: 'captain'; captain: Captain; place: Deck | Dock | null }

const crewOf = (d: Deck) => [...d.flight, ...d.hangar, ...d.stranded]

export function findFigure(ship: Ship | null, id: string): Figure | null {
  if (!ship) return null
  for (const deck of ship.decks) {
    const robot = crewOf(deck).find((r) => r.id === id)
    if (robot) return { kind: 'robot', robot, deck }
  }
  const blocked = ship.bridge.blocked.find((r) => r.id === id)
  if (blocked) return { kind: 'robot', robot: blocked, deck: ship.decks.find((d) => [...d.captains, ...d.quiet].some((c) => c.id === blocked.captainId)) ?? null }
  for (const deck of ship.decks) {
    const captain = [...deck.captains, ...deck.quiet].find((c) => c.id === id)
    if (captain) return { kind: 'captain', captain, place: deck }
  }
  for (const dock of ship.docks) {
    const captain = dock.captains.find((c) => c.id === id)
    if (captain) return { kind: 'captain', captain, place: dock }
  }
  return null
}

/** The pane of this app running session `sessionId`, as the fleet knows it. */
export function fleetPane(repos: readonly RepoNode[], sessionId: string | null): number | null {
  if (!sessionId) return null
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) if (a.sessionId === sessionId && a.paneId !== null) return a.paneId
  return null
}

export const OUTSIDE =
  'This session runs outside the app, in a terminal of its own. Opening it here would start a second copy of it, so its conversation is shown read-only.'
export const ENDED = 'This session has ended. Its conversation is shown read-only.'
export const CHILD_ENDED = 'This child has ended: there is no session to attach to. Its conversation is shown read-only.'

export const labelOf = (f: Figure) => (f.kind === 'robot' ? f.robot.label + (f.robot.twin ? `·${f.robot.twin}` : '') : f.captain.name)

/** How figure `id` opens: the tab, and the session to hold for it (none when it is shown
 *  read-only). Null for what has no session (the empty chair) or is not on the ship.
 *  - A session in a pane is held by its pane, robot or captain: never a second attach to it. The
 *    pane is the layout's (`inLayout`), else the fleet's: the fleet lags, and knows no pane in a
 *    repo it does not list.
 *  - A live child in no pane is held by `claude attach` on its account.
 *  - A captain alive outside the app has no terminal to borrow, and an ended session none to
 *    show: their conversation, read-only. */
export function openingOf(
  id: string,
  ship: Ship | null,
  repos: readonly RepoNode[],
  inLayout: (sessionId: string) => number | null = () => null,
): { tab: DrawerTab; ref: SessionRef | null } | null {
  const f = findFigure(ship, id)
  if (!f) return null
  const paneOf = (repos: readonly RepoNode[], sessionId: string | null) => (sessionId ? (inLayout(sessionId) ?? fleetPane(repos, sessionId)) : null)
  const tab = (key: null, readOnly: string | null): DrawerTab => ({ id, kind: f.kind, key, readOnly, label: labelOf(f), sessionId: sessionIdOf(f), cwd: cwdOf(f) })
  if (f.kind === 'robot') {
    const { child } = f.robot
    const pane = paneOf(repos, f.robot.sessionId ?? child.session_id)
    if (pane !== null) return { tab: tab(null, null), ref: { pane } }
    if (child.live) return { tab: tab(null, null), ref: { child } }
    return { tab: tab(null, CHILD_ENDED), ref: null }
  }
  const { parent } = f.captain
  if (!parent) return null
  const pane = paneOf(repos, parent.session_id)
  if (pane !== null) return { tab: tab(null, null), ref: { pane } }
  return { tab: tab(null, f.captain.pose === 'offline' ? ENDED : OUTSIDE), ref: null }
}

/** A breadcrumb: `go` opens that figure in the drawer, `repo` a terminal in that repo, in the drawer too. */
export type Crumb = { text: string; go?: string; repo?: string; here?: true }

/** The repo a session's `cwd` is in: the fleet's repo holding it, else the `<repo>` a
 *  `<repo>-wt-<name>` folder on its path folds into; null when neither says. */
export function repoOf(cwd: string, repos: readonly RepoNode[]): { root: string; name: string } | null {
  const c = norm(cwd)
  let best: { root: string; name: string; depth: number } | null = null
  for (const r of repos) {
    for (const p of [r.root, ...r.worktrees.map((w) => w.path)]) {
      const d = norm(p)
      if (within(c, d) && (!best || d.length > best.depth)) best = { root: r.root, name: r.name, depth: d.length }
    }
  }
  if (best) return { root: best.root, name: best.name }
  const parts = c.split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    const at = parts[i].indexOf('-wt-')
    if (at <= 0) continue
    const root = [...parts.slice(0, i), parts[i].slice(0, at)].join('/')
    return { root, name: basename(root) }
  }
  return null
}

/** A robot's repo is its own (`child.cwd`): a captain may dispatch into another repo than its
 *  deck's. */
export function crumbsOf(f: Figure, ship: Ship | null, repos: readonly RepoNode[] = []): Crumb[] {
  const place = f.kind === 'robot' ? (repoOf(f.robot.child.cwd, repos) ?? f.deck) : f.place
  const out: Crumb[] = place ? [{ text: place.name, repo: place.root }] : []
  if (f.kind === 'captain') return [...out, { text: `${f.captain.emblem} ${f.captain.name}`, here: true }]
  const captain = findFigure(ship, f.robot.captainId)
  if (captain?.kind === 'captain') out.push(captain.captain.parent ? { text: `${captain.captain.emblem} ${captain.captain.name}`, go: captain.captain.id } : { text: 'no captain' })
  if (f.robot.via) out.push({ text: f.robot.via })
  return [...out, { text: labelOf(f), here: true }]
}

/** The state in words and its colour: colour means state only. */
export function stateOf(f: Figure): { text: string; tone: AgentState } {
  if (f.kind === 'robot') {
    switch (f.robot.state) {
      case 'working':
        return { text: 'working', tone: 'working' }
      case 'need':
        return { text: 'needs you', tone: 'needs-you' }
      case 'done':
        return { text: 'ready', tone: 'done' }
      case 'stopped':
        return { text: 'stopped', tone: 'idle' }
      default:
        return { text: 'idle', tone: 'idle' }
    }
  }
  switch (f.captain.pose) {
    case 'busy':
      return { text: 'working', tone: 'working' }
    case 'alert':
      return { text: 'a child needs you', tone: 'needs-you' }
    case 'offline':
      return { text: 'ended', tone: 'idle' }
    case 'asleep':
      return { text: 'asleep', tone: 'idle' }
    default:
      return { text: 'idle', tone: 'idle' }
  }
}

export function contextOf(f: Figure, feed: Feed | null): number | null {
  return f.kind === 'robot' ? f.robot.context : (feed?.sessions[f.captain.id]?.context ?? null)
}

/** `182k`, `9.4k`, `640`. */
export function tokens(n: number): string {
  if (n < 1000) return String(n)
  return n < 10_000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`
}

export function spriteOf(f: Figure): SpriteSheet {
  if (f.kind === 'captain') return f.captain.pose === 'empty' ? SHIP_SPRITES.chair : SHIP_SPRITES.captain[f.captain.pose]
  const pose = f.robot.state === 'working' ? 'working' : f.robot.state === 'need' ? 'waiting' : f.robot.state === 'idle' ? 'idle' : 'sleeping'
  return SPRITES.robots[f.robot.klass][pose]
}

/** Where its session runs, and the line under its header. */
export const cwdOf = (f: Figure) => (f.kind === 'robot' ? f.robot.child.cwd : (f.captain.parent?.cwd ?? null))
export const sessionIdOf = (f: Figure) => (f.kind === 'robot' ? (f.robot.sessionId ?? f.robot.child.session_id) : (f.captain.parent?.session_id ?? null))
export const lineOf = (f: Figure) => (f.kind === 'robot' ? f.robot.line : f.captain.topic ? `“${f.captain.topic}”` : '')

/** The deepest of `known` worktrees holding `cwd`, as the Dispatch tab finds a child's; `cwd`
 *  itself when none does. */
export function deepestWorktree(cwd: string, known: readonly string[]): string {
  const c = norm(cwd)
  return known.map(norm).filter((w) => within(c, w)).sort((a, b) => b.length - a.length)[0] ?? c
}

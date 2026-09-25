import { createContext } from 'react'
import { allChildren, childWord, type ChildSession, type Snapshot } from '../mission/types'

/** Wave B's Dispatch tab (`src/dispatch/`, the `dispatch-tab` piece): every way into a dispatched
 *  child leads to its parent's tab. That piece lands beside this one, so it is reached through
 *  `import.meta.glob`: with `src/dispatch/index.ts` missing the glob finds nothing, children stay
 *  cards of their own and their clicks show their worktree, as before; once it merges, it wires
 *  itself. */

/** One wave under a parent workspace, as its sidebar line counts it. */
export type WaveLine = { feature: string; needsYou: number; working: number; done: number }

export type DispatchRoutes = {
  /** Show the Dispatch tab of workspace `parent`, with `child` (a `ChildSession.id`) selected. */
  openDispatch(parent: string, child?: string): void
  /** The workspace a child belongs to: its parent session's worktree, else its repo's main
   *  checkout; null when the snapshot does not know the child. */
  parentWorktree(childId: string): string | null
  /** The waves dispatched from `parent`, newest first. A hook. */
  useWaveLines(parent: string): WaveLine[]
}

const found = Object.values(import.meta.glob<Partial<DispatchRoutes>>('../dispatch/index.ts', { eager: true }))[0]

/** The Dispatch tab's routes, or null before it lands. Its names are read at call time, so an
 *  import cycle through the tab cannot leave them undefined here. */
export const dispatchRoutes: DispatchRoutes | null = found
  ? {
      openDispatch: (parent, child) => found.openDispatch!(parent, child),
      parentWorktree: (childId) => found.parentWorktree!(childId),
      useWaveLines: (parent) => found.useWaveLines!(parent),
    }
  : null

/** What the sidebar's cards draw with. `view.tsx` gives it `dispatchRoutes`; a test gives fakes,
 *  or nothing, and then children stay cards as they were. */
export const DispatchContext = createContext<DispatchRoutes | null>(null)

/** The dispatched child session `sessionId` is. The fleet keys a child by its session id, or by
 *  its short id (the session id's first eight characters) before mnemo knows the full one, and a
 *  hook names it by the full one: all three find it. */
export function childOf(snap: Snapshot, sessionId: string): ChildSession | null {
  return allChildren(snap).find((c) => c.session_id === sessionId || c.id === sessionId || sessionId.startsWith(c.id)) ?? null
}

/** Show `childId` in its parent's Dispatch tab. False when the tab cannot take it — it has not
 *  landed, or no parent is known — so the caller does what it did before. */
export function openChild(routes: DispatchRoutes | null, childId: string): boolean {
  if (!routes) return false
  const parent = routes.parentWorktree(childId)
  if (parent === null) return false
  routes.openDispatch(parent, childId)
  return true
}

/** A click on an agent that may be a dispatched child: its parent's Dispatch tab, when it is one
 *  and the tab can take it. */
export function openChildSession(routes: DispatchRoutes | null, snap: Snapshot, sessionId: string): boolean {
  const child = routes && childOf(snap, sessionId)
  return !!child && openChild(routes, child.id)
}

const needsYou = (c: ChildSession) => childWord(c) === 'BLOCKED' || (c.live && !!c.waiting_for)

/** The child a wave line opens the tab on: of the wave's children under `parent`, the first that
 *  needs you, else the first still running, else the first. Null when it has none there. */
export function waveChild(routes: DispatchRoutes, snap: Snapshot, feature: string, parent: string): string | null {
  const children = snap.repos
    .flatMap((r) => r.missions.filter((m) => m.feature === feature))
    .flatMap((m) => m.pieces.flatMap((p) => (p.child ? [p.child] : [])))
    .filter((c) => routes.parentWorktree(c.id) === parent)
  const pick = children.find(needsYou) ?? children.find((c) => childWord(c) === 'active' || childWord(c) === 'stalled') ?? children[0]
  return pick?.id ?? null
}

/** A click on a wave line: the parent's tab on that wave, through one of its children. A line
 *  with none found (the tab's own "Issues" line) opens on its feature, which the tab also takes. */
export function openWave(routes: DispatchRoutes, snap: Snapshot, feature: string, parent: string): void {
  routes.openDispatch(parent, waveChild(routes, snap, feature, parent) ?? feature)
}

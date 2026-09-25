import type { StoreApi } from 'zustand/vanilla'
import type { Store } from '../layout/store'
import type { PaneId } from '../layout/tree'
import { allChildren, type ChildSession, type Snapshot } from '../mission/types'
import { issueKey, waveKey } from './model'
import { placeDispatch } from './open'
import { markSeen, seenStore, type Seen } from './seen'
import { reveal } from './store'

/** The tab opens by itself when a parent dispatches a wave (spec decision 4): once per wave, when
 *  its first child shows up in the snapshot and the session that dispatched it runs in a
 *  terminal of this app (found within `GRACE_MS`). Beside that terminal, and the terminal keeps the keys. Closed, it stays
 *  closed until a click brings it back (`openDispatch`), whatever else the wave does. */

/** The waves of `snap` never seen before, each with the first of its children listed: a wave by
 *  its feature, a child of no wave on its own. A piece with only a PR left is no arrival. */
export function arrivals(snap: Snapshot, seen: Seen): { key: string; child: ChildSession }[] {
  const out = new Map<string, ChildSession>()
  const add = (key: string, c: ChildSession) => {
    if (!(key in seen) && !out.has(key)) out.set(key, c)
  }
  for (const r of snap.repos) {
    for (const m of r.missions) for (const p of m.pieces) if (p.child) add(waveKey(r.root, m.feature), p.child)
    for (const c of r.children) add(issueKey(r.root, c.id), c)
  }
  return [...out].map(([key, child]) => ({ key, child }))
}

const listsChildren = (snap: Snapshot) => snap.repos.some((r) => r.children.length || r.missions.some((m) => m.pieces.some((p) => p.child)))

export type WatchDeps = {
  layout: Store
  mission: StoreApi<{ snapshot: Snapshot }>
  /** The child's parent workspace (`parentWorktree`). */
  parentOf(child: ChildSession): string | null
  /** The terminal of this app the child's parent session runs in, if one does. */
  paneOf(child: ChildSession): PaneId | null
  now(): number
}

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** How long a new wave waits for its parent's terminal to be found: a pane learns which session
 *  it runs every few seconds, and the workspace restore recreates them after the first snapshots. */
export const GRACE_MS = 30_000

/** Watches the snapshots; returns the way to stop. What is listed at the first snapshot was
 *  dispatched before anything watched, and opens nothing. A tab owed to a workspace not shown
 *  opens, beside the parent's terminal, when that workspace is shown next. */
export function watchDispatches(deps: WatchDeps): () => void {
  let started = false
  const owed = new Map<string, PaneId>()
  /** Waves that arrived, by key, until their parent's terminal is found or `GRACE_MS` is past. */
  const arrived = new Map<string, { id: string; until: number }>()

  const onSnapshot = (snap: Snapshot) => {
    // A snapshot whose `mnemo sessions` failed lists no child: every one would look new after it.
    if (!snap.at || (!started && snap.errors.length && !listsChildren(snap))) return
    const first = !started
    started = true
    const now = deps.now()
    const fresh = arrivals(snap, seenStore.getState().seen)
    if (fresh.length) markSeen(
      fresh.map((f) => f.key),
      first ? 0 : now,
    )
    if (first) return
    for (const f of fresh) arrived.set(f.key, { id: f.child.id, until: now + GRACE_MS })
    const children = new Map(allChildren(snap).map((c) => [c.id, c]))
    for (const [key, a] of arrived) {
      const child = children.get(a.id)
      if (!child?.live || now > a.until) {
        arrived.delete(key)
        continue
      }
      const pane = deps.paneOf(child)
      const parent = pane === null ? null : deps.parentOf(child)
      if (pane === null || parent === null) continue
      arrived.delete(key)
      reveal(parent, child.id)
      if (placeDispatch(deps.layout, parent, { beside: pane, focus: false }) === null) owed.set(norm(parent), pane)
    }
  }

  const offMission = deps.mission.subscribe((s, p) => void (s.snapshot !== p.snapshot && onSnapshot(s.snapshot)))
  const offLayout = deps.layout.subscribe((s, p) => {
    if (s.activeWorktree === p.activeWorktree || s.activeWorktree === null) return
    const at = norm(s.activeWorktree)
    const pane = owed.get(at)
    if (pane === undefined) return
    owed.delete(at)
    placeDispatch(deps.layout, at, { beside: pane, focus: false })
  })
  onSnapshot(deps.mission.getState().snapshot)
  return () => {
    offMission()
    offLayout()
  }
}

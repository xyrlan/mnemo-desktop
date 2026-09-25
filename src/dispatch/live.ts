import { useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { missionStore, useMission } from '../mission/app-store'
import { fleetStore, useFleet } from '../fleet/store'
import type { RepoNode } from '../fleet/types'
import { store as layout, useApp } from '../layout/app-store'
import { paneForSession } from '../layout/tabs'
import type { PaneId } from '../layout/tree'
import { allChildren, type ChildSession } from '../mission/types'
import { parentOf, waveLines, wavesOf, type Wave, type WaveLine } from './model'
import { placeDispatch } from './open'
import { seenStore } from './seen'
import { reveal, select } from './store'

/** The model on the app's live stores: the mission snapshot, the fleet's worktrees, the open
 *  workspaces and the waves seen. */

/** Every worktree the app knows: the fleet's (the sidebar's cards) and the open ones. */
export function knownWorktrees(repos: readonly RepoNode[], open: readonly string[]): string[] {
  return [...repos.flatMap((r) => r.worktrees.map((w) => w.path)), ...open]
}

/** The parent workspace of child `childId` (its `ChildSession.id`): the worktree holding the cwd
 *  of the session that dispatched it, else the repo's main checkout. Null when the snapshot does
 *  not list the child. */
export function parentWorktree(childId: string): string | null {
  return parentOf(missionStore.getState().snapshot, childId, knownWorktrees(fleetStore.getState().repos, layout.getState().worktrees))
}

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** The terminal of this app that `child`'s parent session runs in, if one does. */
export function parentPaneOf(child: ChildSession): PaneId | null {
  if (!child.parent_session) return null
  const session = missionStore.getState().snapshot.repos.flatMap((r) => r.parents).find((p) => p.session_id === child.parent_session)
  return paneForSession(layout.getState(), { session_id: child.parent_session, cwd: session?.cwd ?? '' })
}

/** The terminal of a session that dispatched children into `parent`'s tab: `child`'s first. */
function parentPane(parent: string, child?: string): PaneId | null {
  const children = allChildren(missionStore.getState().snapshot)
  const mine = children.filter((c) => c.id === child || parentWorktree(c.id) === parent)
  for (const c of [...mine.filter((c) => c.id === child), ...mine]) {
    const pane = parentPaneOf(c)
    if (pane !== null) return pane
  }
  return null
}

/** Shows parent workspace `parent` (a fleet `WorktreeNode.path`) with its Dispatch tab open and
 *  focused, beside the parent's terminal when it has to open. `child` (a `ChildSession.id`) is
 *  selected, its wave unfolded and scrolled to; a wave's feature, or `ISSUES`, opens on that
 *  section with nothing selected. */
export function openDispatch(parent: string, child?: string): void {
  const path = norm(parent)
  const s = layout.getState()
  // Shown at once: the switch is synchronous before its promise.
  if (s.activeWorktree === null || norm(s.activeWorktree) !== path) void s.switchWorktree(path)
  if (child) {
    if (allChildren(missionStore.getState().snapshot).some((c) => c.id === child)) select(path, child)
    reveal(path, child)
  }
  placeDispatch(layout, path, { beside: parentPane(path, child), focus: true })
}

/** The sections of `parent`'s Dispatch tab, kept current. */
export function useWaves(parent: string): Wave[] {
  const snap = useMission((s) => s.snapshot)
  const repos = useFleet((f) => f.repos)
  const open = useApp((s) => s.worktrees)
  const seen = useStore(seenStore, (s) => s.seen)
  return useMemo(() => wavesOf(snap, parent, knownWorktrees(repos, open), (k) => seen[k] || undefined), [snap, parent, repos, open, seen])
}

/** The left sidebar's lines for parent workspace `parent` (a fleet `WorktreeNode.path`): one per
 *  section of its Dispatch tab, in its order, the last `ISSUES` when it has children of no wave.
 *  The same array until a count changes, so a snapshot that changes nothing re-renders nothing. */
export function useWaveLines(parent: string): WaveLine[] {
  const waves = useWaves(parent)
  const last = useRef<{ lines: WaveLine[]; json: string } | null>(null)
  const lines = waveLines(waves)
  const json = JSON.stringify(lines)
  if (last.current?.json !== json) last.current = { lines, json }
  return last.current.lines
}

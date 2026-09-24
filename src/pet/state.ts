/** What the pet is doing: one state for the whole fleet, and where it sits on screen. Pure. */
import type { AgentState, Fleet } from '../fleet/types'
import { POSES, STATE_SCENES, type Scene } from '../avatar/scenes'
import { healthOf, poseOf, toneOf } from '../vaultlevel/level'
import type { VaultLevel } from '../vaultlevel/types'

/** Most urgent first: a pet that is waiting on you says so even while others work. */
const PRIORITY: AgentState[] = ['needs-you', 'working', 'done']

export function petStateOf(fleet: Pick<Fleet, 'repos'>): AgentState {
  const seen = new Set<AgentState>()
  for (const repo of fleet.repos) for (const wt of repo.worktrees) for (const a of wt.agents) seen.add(a.state)
  return PRIORITY.find((s) => seen.has(s)) ?? 'idle'
}

/** The scene for a state. Idle wears the vault's pose (health decides the silhouette); before
 *  the vault is read it breathes as `fair`. */
export function petScene(state: AgentState, vault?: VaultLevel): Scene {
  switch (state) {
    case 'working':
      return STATE_SCENES.active
    case 'needs-you':
      return STATE_SCENES.BLOCKED
    case 'done':
      return STATE_SCENES.done
    case 'idle':
      return vault && !vault.error ? POSES[poseOf(toneOf(healthOf(vault)))] : POSES.fair
  }
}

export type Point = { x: number; y: number }
export const PET_SIZE = 64
export const MARGIN = 8
export const STORAGE_KEY = 'mnemo.pet.position'

/** Keeps the whole sprite inside the window. */
export function clampPosition(p: Point, view: { width: number; height: number }, size = PET_SIZE): Point {
  const cap = (n: number, max: number) => Math.min(Math.max(MARGIN, n), Math.max(MARGIN, max - size - MARGIN))
  return { x: cap(p.x, view.width), y: cap(p.y, view.height) }
}

/** The bottom-right corner of the workbench: `rightInset` is the right sidebar's width while it
 *  is open, so the pet does not sit on its panels (Source Control's Commit button is down there). */
export const defaultPosition = (view: { width: number; height: number }, rightInset = 0): Point =>
  clampPosition({ x: view.width - rightInset - PET_SIZE - MARGIN, y: view.height }, view)

export function loadPosition(storage: Pick<Storage, 'getItem'>): Point | null {
  try {
    const v = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null
  } catch {
    return null
  }
}

export function savePosition(storage: Pick<Storage, 'setItem'>, p: Point): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage blocked: the pet forgets where it was, nothing else */
  }
}

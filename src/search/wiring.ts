import type React from 'react'
import type { RepoNode } from '../fleet/store'

export type RightbarPanel = {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  order: number
  panel: React.ComponentType
}

type PanelsModule = { registerRightbarPanel?: (item: RightbarPanel) => () => void }

/** `src/rightbar/panels.ts` lands in parallel with this panel (orca-redesign-d). Globbed, a
 *  missing module finds nothing and the panel waits unregistered; once it lands, this finds it
 *  with no edit here. */
const panels = Object.values(import.meta.glob<PanelsModule>('../rightbar/panels.ts', { eager: true }))[0]

/** Adds the panel as a right-sidebar tab; returns what removes it. */
export function registerPanel(item: RightbarPanel, mod: PanelsModule | undefined = panels): () => void {
  return mod?.registerRightbarPanel?.(item) ?? (() => {})
}

/** The worktree the panel searches: the one on screen, else the first repo's main checkout. */
export function searchRoot(activeWorktree: string | null, repos: RepoNode[]): string | null {
  if (activeWorktree) return activeWorktree
  const first = repos[0]
  return first ? (first.worktrees.find((w) => w.kind === 'main')?.path ?? first.root) : null
}

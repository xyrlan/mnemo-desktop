import type { RepoNode } from '../fleet/types'

/** The worktree shown while none is chosen: the first repo's main checkout (its root, when the
 *  fleet has not listed its worktrees yet). Null with no repo. */
export function firstWorktree(repos: readonly RepoNode[]): string | null {
  const repo = repos[0]
  if (!repo) return null
  return repo.worktrees.find((w) => w.kind === 'main')?.path ?? repo.root
}

export type FirstWorktreeSources = {
  /** The worktree shown now; null when none is. */
  shown(): string | null
  repos(): readonly RepoNode[]
  switchTo(path: string): void
  /** Calls `cb` whenever `shown` or `repos` may have changed; returns the way to stop. */
  onChange(cb: () => void): () => void
}

/** Whenever no worktree is shown — at launch, before one is chosen, or after the last one open
 *  was closed — shows `firstWorktree`, as soon as the fleet knows a repo. Start it once the
 *  saved workspace is restored, which chooses one of its own. Returns the way to stop. */
export function keepAWorktreeShown(src: FirstWorktreeSources): () => void {
  const check = () => {
    if (src.shown() !== null) return
    const path = firstWorktree(src.repos())
    if (path !== null) src.switchTo(path)
  }
  const off = src.onChange(check)
  check()
  return off
}

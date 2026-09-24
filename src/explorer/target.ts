import type { RepoNode } from '../fleet/types'
import { basename } from './paths'

/** The worktree on screen, as the Memory panel reads it: the shell's choice, else the first
 *  repo's main checkout. */
export function rootOf(activeWorktree: string | null, repos: readonly RepoNode[]): string | null {
  if (activeWorktree) return activeWorktree
  const first = repos[0]
  return first ? (first.worktrees.find((w) => w.kind === 'main')?.path ?? first.root) : null
}

export function repoNameOf(root: string, repos: readonly RepoNode[]): string {
  for (const r of repos) if (r.root === root || r.worktrees.some((w) => w.path === root)) return r.name
  return basename(root)
}

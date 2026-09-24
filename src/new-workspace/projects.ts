import type { RepoNode } from '../fleet/types'
import type { ProjectOption } from './match'

/** The composer's projects: the fleet's repos, in the fleet's order. */
export function projectOptions(repos: readonly RepoNode[]): ProjectOption[] {
  return repos.map((r) => {
    const main = r.worktrees.find((w) => w.kind === 'main') ?? null
    const taken = new Set<string>()
    for (const w of r.worktrees) {
      if (w.branch) taken.add(w.branch)
      taken.add(w.name)
    }
    return { id: r.root, displayName: r.name, detail: r.root, mainBranch: main?.branch ?? null, taken: [...taken] }
  })
}

/** The repo holding worktree `path`, or null (nothing shown, or a tree the fleet does not know). */
export function projectOf(repos: readonly RepoNode[], path: string | null): string | null {
  if (!path) return null
  return repos.find((r) => r.root === path || r.worktrees.some((w) => w.path === path))?.root ?? null
}

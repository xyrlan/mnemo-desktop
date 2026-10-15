import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { RepoNode } from '../../../fleet/store'
import { useKnownRepos, type KnownRepo } from '../../repos'
import { samePath } from '../../../path/path'

/** The repo the Memory and learned windows read for: the one picked in either, kept while the
 *  app runs. Null until one is picked: the first repo the fleet knows stands in. */
export const repoChoice = createStore<{ root: string | null }>(() => ({ root: null }))

export const chooseRepo = (root: string) => repoChoice.setState({ root })

/** The picked repo while it is still known, else the first; null with none. */
export function pickRepo(repos: readonly Pick<RepoNode, 'root' | 'name'>[], chosen: string | null): Pick<RepoNode, 'root' | 'name'> | null {
  return (chosen !== null ? repos.find((r) => samePath(r.root, chosen)) : undefined) ?? repos[0] ?? null
}

/** Every repo the Nexus knows (`useKnownRepos`: the fleet's, PROJECTS', the saved projects) and
 *  the one the windows read for. */
export function useRepo(): { repos: KnownRepo[]; repo: Pick<RepoNode, 'root' | 'name'> | null } {
  const repos = useKnownRepos()
  const chosen = useStore(repoChoice, (s) => s.root)
  return { repos, repo: pickRepo(repos, chosen) }
}

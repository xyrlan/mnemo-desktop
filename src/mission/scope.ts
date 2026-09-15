import type { Pane, State } from '../layout/store'
import { leaves } from '../layout/tree'
import { allChildren, type RepoGroup, type Snapshot } from './types'

export type Scope = 'repo' | 'all'

const dirname = (p: string) => p.replace(/\/+[^/]*$/, '') || '/'
const under = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/')

/** The directory a pane is working in: a terminal's OSC 7 cwd, an editor's tree root (else
 *  its file's folder), a mission pane's child worktree. Other views have none. */
export function paneCwd(pane: Pane | undefined, snap: Snapshot): string | undefined {
  if (!pane) return undefined
  if (pane.view === 'terminal') return pane.cwd || undefined
  const props = pane.props ?? {}
  if (pane.view === 'editor') {
    if (typeof props.root === 'string' && props.root) return props.root
    if (typeof props.path === 'string' && props.path.startsWith('/')) return dirname(props.path)
    return undefined
  }
  if (pane.view === 'mission') {
    const id = String(props.id ?? '')
    return allChildren(snap).find((c) => c.id === id)?.cwd || undefined
  }
  return undefined
}

/** The cwd of the focused pane, else of the first other pane in the active tab that has one:
 *  a cockpit or browser pane is often the focused one while its neighbour says where you are. */
export function focusedCwd(s: Pick<State, 'tabs' | 'activeTab' | 'panes'>, snap: Snapshot): string | undefined {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return undefined
  for (const id of [tab.focused, ...leaves(tab.root).filter((p) => p !== tab.focused)]) {
    const cwd = paneCwd(s.panes[id], snap)
    if (cwd) return cwd
  }
  return undefined
}

/** The repo group a cwd belongs to. A child's worktree usually sits beside the main checkout,
 *  not under it, so session cwds count as well as the root; the deepest match wins. */
export function repoOfCwd(snap: Snapshot, cwd: string | undefined): RepoGroup | undefined {
  if (!cwd) return undefined
  let best: { repo: RepoGroup; depth: number } | undefined
  for (const repo of snap.repos) {
    const dirs = [
      repo.root,
      ...repo.parents.map((p) => p.cwd),
      ...repo.children.map((c) => c.cwd),
      ...repo.missions.flatMap((m) => m.pieces.map((p) => p.child?.cwd)),
    ]
    for (const d of dirs) {
      if (!d || !under(cwd, d)) continue
      if (!best || d.length > best.depth) best = { repo, depth: d.length }
    }
  }
  return best?.repo
}

/** The repos a surface shows. `repo` narrows to the focused repo (possibly to nothing, when
 *  that repo has no recent sessions) and falls back to `all` when no repo resolved;
 *  `effective` says which one applied. */
export function scopeRepos(snap: Snapshot, scope: Scope, focusedRoot: string | undefined): { repos: RepoGroup[]; effective: Scope } {
  if (scope === 'repo' && focusedRoot) return { repos: snap.repos.filter((r) => r.root === focusedRoot), effective: 'repo' }
  return { repos: snap.repos, effective: 'all' }
}

import type { State } from '../layout/store'
import { focusedCwd, repoOfCwd } from '../mission/scope'
import type { Snapshot } from '../mission/types'

type HomeLike = { repos: { root: string }[]; selected: string | null }

const under = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/')

/** The repo a board opened now is about: the focused pane's repo (from the mission snapshot,
 *  else a Home repo containing its cwd), else Home's selected repo, else the first repo with
 *  sessions. */
export function boardRoot(layout: Pick<State, 'tabs' | 'activeTab' | 'panes'>, snap: Snapshot, home: HomeLike): string | undefined {
  const cwd = focusedCwd(layout, snap)
  const fromSnap = repoOfCwd(snap, cwd)?.root
  if (fromSnap) return fromSnap
  const fromHome = cwd ? home.repos.filter((r) => under(cwd, r.root)).sort((a, b) => b.root.length - a.root.length)[0]?.root : undefined
  return fromHome ?? home.selected ?? snap.repos[0]?.root
}

/** Every repo the board can switch to, `current` included even when nothing else knows it. */
export function knownRoots(snap: Snapshot, home: HomeLike, current?: string): string[] {
  return [...new Set([...(current ? [current] : []), ...snap.repos.map((r) => r.root), ...home.repos.map((r) => r.root)])]
}

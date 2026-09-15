import type { Pane } from '../layout/store'
import type { ParentSession, Snapshot } from '../mission/types'
import { parentTokenLine } from '../mission/tokens'
import { paneCwd, repoOfCwd } from '../mission/scope'

const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/'
const basename = (p: string) => trimSlash(p).split('/').pop() || p

/** The Claude session a pane runs: the one it was opened for, else the only live parent
 *  sitting in exactly its cwd. Two parents in one directory are ambiguous: none. */
export function paneParent(pane: Pane | undefined, cwd: string | undefined, snap: Snapshot): ParentSession | undefined {
  if (!pane) return undefined
  const parents = snap.repos.flatMap((r) => r.parents)
  if (pane.sessionId) {
    const own = parents.find((p) => p.session_id === pane.sessionId)
    if (own) return own
  }
  if (!cwd || pane.view !== 'terminal') return undefined
  const here = parents.filter((p) => p.cwd && trimSlash(p.cwd) === trimSlash(cwd))
  return here.length === 1 ? here[0] : undefined
}

export type BarInfo = {
  cwd?: string
  /** Repo name, else the folder name when the cwd is outside any repo. */
  place?: string
  branch?: string
  /** `parent 210k · children 640k`, absent when the snapshot has no counts. */
  tokens?: string
  /** What the pane calls itself (terminal title, view title), or its view name. */
  title: string
}

/** Everything the bar shows, from the pane, the mission snapshot and what git said. */
export function barInfo(pane: Pane | undefined, snap: Snapshot, git: { repo?: string | null; branch?: string | null } = {}): BarInfo {
  const cwd = paneCwd(pane, snap)
  const parent = paneParent(pane, cwd, snap)
  const place = cwd ? git.repo || repoOfCwd(snap, cwd)?.name || basename(cwd) : undefined
  return {
    cwd,
    place,
    branch: git.branch || undefined,
    tokens: (parent && parentTokenLine(parent)) || undefined,
    title: pane?.title || pane?.view || '',
  }
}

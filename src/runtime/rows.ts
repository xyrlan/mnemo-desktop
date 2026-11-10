// A world session as the mission snapshot knows it. The world is what views read; every path that
// acts on a session (an attach, an answer, a merge) takes the snapshot's own row, which carries the
// account the session runs on.

import { allChildren, type ChildSession, type Mission, type ParentSession, type Pr, type Snapshot } from '../mission/types'
import { basename, dirname, norm, samePath, within } from '../path/path'
import type { PullRequest, Session } from '../world/types'

/** The dispatched child a world session is: by its session id, by its short id, or by a session
 *  id its short id begins, before mnemo knows the full one (as `figureOf` in `src/notify`). */
export function childRow(snap: Snapshot, s: Pick<Session, 'id'>): ChildSession | undefined {
  return allChildren(snap).find((c) => c.session_id === s.id || c.id === s.id || (c.id !== '' && s.id.startsWith(c.id)))
}

export function parentRow(snap: Snapshot, sessionId: string): ParentSession | undefined {
  for (const r of snap.repos) for (const p of r.parents) if (p.session_id === sessionId) return p
  return undefined
}

/** The session id the world lists child `c` under. */
export const sessionIdOf = (c: Pick<ChildSession, 'id' | 'session_id'>): string => c.session_id ?? c.id

/** The pull request the snapshot holds for child `c`: its piece's, when it is a piece of a
 *  contract, else its own. `number` narrows it to the one a card shows. */
export function prRow(snap: Snapshot, c: ChildSession, number?: number): Pr | null {
  const found: Pr[] = []
  for (const r of snap.repos) for (const m of r.missions) for (const p of m.pieces) if (p.child?.id === c.id && p.pr) found.push(p.pr)
  if (c.pr) found.push(c.pr)
  return (number === undefined ? found[0] : found.find((p) => p.number === number)) ?? null
}

/** A world pull request as the merge takes it, when the snapshot holds none of that number. */
export const prOf = (p: PullRequest): Pr => ({ number: p.number, url: p.url, state: (p.state ?? 'open').toUpperCase(), head: '', ci: 'none', draft: p.draft ?? undefined })

/** The repo a folder is in, from the folder itself: a known repo holding it, else the `<repo>` a
 *  `<repo>-wt-<name>` folder folds into (a known one first), else the folder (`repoRootOf` in
 *  `src/nexus/command/find.ts`, on the snapshot's repos). */
export function repoRoot(cwd: string, known: readonly string[]): string {
  const inside = known.filter((k) => within(cwd, k)).sort((a, b) => norm(b).length - norm(a).length)[0]
  if (inside) return inside
  const name = basename(cwd)
  const dir = dirname(cwd)
  const bases: string[] = []
  for (let i = name.indexOf('-wt-'); i >= 0; i = name.indexOf('-wt-', i + 1)) if (i > 0 && i + 4 < name.length) bases.push(`${dir.endsWith('/') ? dir : `${dir}/`}${name.slice(0, i)}`)
  if (!bases.length) return cwd
  return known.find((k) => bases.some((b) => samePath(b, k))) ?? bases[0]
}

export const knownRoots = (snap: Snapshot): string[] => snap.repos.map((r) => r.root)

/** Mission `feature` of repo `root`, as the snapshot lists it. */
export function missionRow(snap: Snapshot, root: string, feature: string): Mission | undefined {
  return snap.repos.find((r) => samePath(r.root, root))?.missions.find((m) => m.feature === feature)
}

/** A child still running: it can be stopped and written to. */
export const isRunning = (c: Pick<ChildSession, 'live' | 'state'>): boolean => c.live && c.state !== 'done' && c.state !== 'stopped'

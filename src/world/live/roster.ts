// Who is in the live world: the parents the snapshot lists, the children worth keeping, and
// the parents those children name that the snapshot no longer lists. Both the reader (what to
// ask the core about) and the builder (what to draw) start from this.

import type { ChildSession, ParentSession, Pr, RepoGroup, Snapshot } from '../../mission/types'
import type { PrFate, SessionFeed } from '../../nexus/ship-types'
import { basename, dirname, norm } from '../../path/path'

/** An ended child stays in the world this long after its last sign of life: the window the
 *  prototypes' capture kept, so Score has a day to show. One whose pull request is still open,
 *  or that still waits for an answer, stays however old. */
export const KEEP_ENDED_MS = 48 * 60 * 60 * 1000

export interface Repo {
  root: string
  name: string
}

export interface ParentSeat {
  parent: ParentSession
  repo: Repo
}

export interface ChildSeat {
  child: ChildSession
  /** The Claude Code session id, or the job's short id while mnemo does not know it. */
  sid: string
  /** Its piece's pull request, else its own. */
  pr: Pr | null
  contract: { feature: string; piece: string } | null
  repo: Repo
  /** The session it stands under in the world, or null. */
  parent: string | null
}

/** A session children name as their parent that the snapshot does not list: it has ended. */
export interface GoneSeat {
  sid: string
  repo: Repo
  account: string
}

export interface Roster {
  parents: ParentSeat[]
  children: ChildSeat[]
  gone: GoneSeat[]
}

const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

/** The repo a group's root folds into: itself, or for a `<repo>-wt-<name>` folder its sibling
 *  `<repo>`, preferring one the snapshot knows (as the ship folds them). */
function foldedRoot(root: string, known: Map<string, RepoGroup>): string {
  const name = basename(root)
  const dir = dirname(root)
  const bases: string[] = []
  for (let i = name.indexOf('-wt-'); i >= 0; i = name.indexOf('-wt-', i + 1)) {
    if (i > 0 && i + 4 < name.length) bases.push(joinPath(dir, name.slice(0, i)))
  }
  if (!bases.length) return norm(root)
  return norm(bases.find((b) => known.has(norm(b))) ?? bases[0])
}

export const parseTime = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)

/** The newest of the times given, ignoring missing ones; NaN when none is known. */
export function latest(...xs: Array<number | null | undefined>): number {
  let out = NaN
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x) && !(x <= out)) out = x
  return out
}

/** A pull request nobody merged or closed: the feed's fate when it has one, else the snapshot. */
export function isOpen(pr: Pr | null, fate: PrFate | null | undefined): boolean {
  if (!pr) return false
  return (fate?.state ?? pr.state) === 'OPEN'
}

export function rosterOf(snapshot: Pick<Snapshot, 'repos'>, feed: { sessions: Record<string, SessionFeed>; prs: Record<string, PrFate> }, now: number): Roster {
  const known = new Map(snapshot.repos.map((r) => [norm(r.root), r]))
  const repos = new Map<string, Repo>()
  const repoOf = (r: RepoGroup): Repo => {
    const key = foldedRoot(r.root, known)
    let repo = repos.get(key)
    if (!repo) {
      const base = known.get(key)
      repo = { root: base?.root ?? key, name: base?.name ?? basename(key) }
      repos.set(key, repo)
    }
    return repo
  }

  // Every child once: a piece's row (with its piece's pull request) before the repo's own list.
  const all: Omit<ChildSeat, 'parent'>[] = []
  const seen = new Set<string>()
  for (const r of snapshot.repos) {
    const repo = repoOf(r)
    const put = (child: ChildSession, pr: Pr | null, contract: ChildSeat['contract']) => {
      if (seen.has(child.id)) return
      seen.add(child.id)
      all.push({ child, sid: child.session_id ?? child.id, pr, contract, repo })
    }
    for (const m of r.missions) for (const p of m.pieces) if (p.child) put(p.child, p.pr ?? p.child.pr ?? null, { feature: m.feature, piece: p.name })
    for (const c of r.children) put(c, c.pr ?? null, null)
  }

  const kept = all.filter(({ child: c, pr }) => {
    if (c.live || c.tempo === 'blocked' || isOpen(pr, pr ? feed.prs[pr.url] : null)) return true
    const f = feed.sessions[c.id]
    const last = latest(parseTime(c.updated_at), f?.activity?.at, f?.said?.at)
    // One of unknown age has left already.
    return now - last <= KEEP_ENDED_MS
  })

  // A session listed both ways is the child.
  const childIds = new Set(kept.map((s) => s.sid))
  const parents: ParentSeat[] = []
  const parentIds = new Set<string>()
  for (const r of snapshot.repos) {
    const repo = repoOf(r)
    for (const p of r.parents) {
      if (parentIds.has(p.session_id) || childIds.has(p.session_id)) continue
      parentIds.add(p.session_id)
      parents.push({ parent: p, repo })
    }
  }

  // A parent is linked to its children as the snapshot links them: `parent_session`, which
  // names a parent, another child (a grandchild's), or a session that is no longer listed.
  const byId = new Map<string, string>()
  for (const s of kept) {
    byId.set(s.child.id, s.sid)
    byId.set(s.sid, s.sid)
  }
  const gone = new Map<string, GoneSeat>()
  const children = kept.map((s): ChildSeat => {
    const up = s.child.parent_session ?? null
    if (!up || up === s.sid || up === s.child.id) return { ...s, parent: null }
    if (parentIds.has(up)) return { ...s, parent: up }
    const other = byId.get(up)
    if (other) return { ...s, parent: other }
    if (!gone.has(up)) gone.set(up, { sid: up, repo: s.repo, account: s.child.account })
    return { ...s, parent: up }
  })

  // Two children that name each other would stand under no root and be drawn nowhere: the
  // one that closes the ring stands alone.
  const up = new Map(children.map((s) => [s.sid, s]))
  for (const s of children) {
    let at = s.parent ? up.get(s.parent) : undefined
    for (let guard = 0; at && guard < children.length; guard++) {
      if (at === s) {
        s.parent = null
        break
      }
      at = at.parent ? up.get(at.parent) : undefined
    }
  }

  return { parents, children, gone: [...gone.values()] }
}

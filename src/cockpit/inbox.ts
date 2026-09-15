import { childWord, type ChildSession, type Mission, type RepoGroup, type Snapshot } from '../mission/types'
import { childLabel, needsYou, type Need } from './needs'

/** A child that does not need you: still working, or finished today. */
export type ChildRow = { kind: 'working' | 'done'; key: string; repo: RepoGroup; child: ChildSession; label: string; mission: Mission | null }
export type Row = Need | ChildRow

export type Inbox = { needs: Need[]; working: ChildRow[]; done: ChildRow[] }

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** The cockpit's three lists from one (pruned, scoped) snapshot: what needs you, who is still
 *  working (active or stalled), and who finished today in local time. */
export function buildInbox(snap: Snapshot, now = Date.now()): Inbox {
  const working: ChildRow[] = []
  const done: ChildRow[] = []
  const seen = new Set<string>()
  const today = new Date(now)
  const add = (repo: RepoGroup, c: ChildSession, label: string, mission: Mission | null) => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    const word = childWord(c)
    if (word === 'active' || word === 'stalled') working.push({ kind: 'working', key: `working:${c.id}`, repo, child: c, label, mission })
    else if (word === 'done' && c.updated_at && sameDay(new Date(c.updated_at), today)) done.push({ kind: 'done', key: `done:${c.id}`, repo, child: c, label, mission })
  }
  for (const repo of snap.repos) {
    for (const m of repo.missions) for (const p of m.pieces) if (p.child) add(repo, p.child, childLabel(p.child, p.name), m)
    for (const c of repo.children) add(repo, c, childLabel(c), null)
  }
  return { needs: needsYou(snap), working, done }
}

/** The child a row can attach to or reply as, if any. */
export function rowChild(r: Row): ChildSession | null {
  return r.kind === 'blocked' || r.kind === 'working' || r.kind === 'done' ? r.child : null
}

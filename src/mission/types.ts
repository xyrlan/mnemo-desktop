export type ParentSession = { session_id: string; pid: number | null; name: string | null; status: string; cwd: string }
export type ChildSession = {
  id: string
  session_id: string | null
  name: string | null
  state: string
  tempo: string
  needs: string | null
  detail: string
  suggested_reply: string | null
  cwd: string
  tokens: number
  live: boolean
  updated_at: string | null
  intent: string | null
  branch: string | null
  timeline_len: number
}
export type Pr = { number: number; url: string; state: string; head: string; ci: 'pass' | 'fail' | 'pending' | 'none' }
export type Piece = { name: string; branch: string; child: ChildSession | null; pr: Pr | null }
export type Mission = { feature: string; contract_path: string; pieces: Piece[]; landable: boolean }
export type RepoGroup = { root: string; name: string; parents: ParentSession[]; missions: Mission[]; children: ChildSession[] }
export type Snapshot = { repos: RepoGroup[]; errors: string[]; at: string }
export type TimelineLine = { at: string; state: string; detail: string; text: string }
export type Timeline = { lines: TimelineLine[]; total: number }

/** One word for a child's state+tempo, as the sidebar shows it. */
export function childWord(c: Pick<ChildSession, 'state' | 'tempo' | 'live'>): 'active' | 'BLOCKED' | 'stalled' | 'done' | 'stopped' {
  if (c.state === 'done') return 'done'
  if (c.state === 'stopped' || !c.live) return 'stopped'
  if (c.tempo === 'blocked') return 'BLOCKED'
  if (c.tempo === 'stalled') return 'stalled'
  return 'active'
}

/** Events since the user last looked; 0 when never looked so a fresh child is not a wall of badges. */
export function delta(c: Pick<ChildSession, 'id' | 'timeline_len'>, looked: Record<string, number>): number {
  const seen = looked[c.id]
  if (seen === undefined) return 0
  return Math.max(0, c.timeline_len - seen)
}

export function allChildren(snap: Snapshot): ChildSession[] {
  const out: ChildSession[] = []
  for (const r of snap.repos) {
    for (const m of r.missions) for (const p of m.pieces) if (p.child) out.push(p.child)
    out.push(...r.children)
  }
  return out
}

export function missionSummary(m: Mission): { withPr: number; total: number; ci: 'pass' | 'fail' | 'pending' | 'none' } {
  const prs = m.pieces.map((p) => p.pr).filter((p): p is Pr => !!p)
  const ci = prs.some((p) => p.ci === 'fail') ? 'fail' : prs.some((p) => p.ci === 'pending') ? 'pending' : prs.length ? 'pass' : 'none'
  return { withPr: prs.length, total: m.pieces.length, ci }
}

const RECENT_MS = 6 * 60 * 60 * 1000

/** Live children always; finished ones only for a few hours, so the sidebar is
 *  about now, not a history of every dispatch ever run. */
export function isRecent(c: Pick<ChildSession, 'live' | 'updated_at'>, now = Date.now()): boolean {
  if (c.live) return true
  const t = c.updated_at ? Date.parse(c.updated_at) : NaN
  return Number.isFinite(t) && now - t < RECENT_MS
}

/** Drops stale children and the repo groups left empty by that. */
export function pruneSnapshot(snap: Snapshot, now = Date.now()): Snapshot {
  const repos = snap.repos
    .map((r) => ({
      ...r,
      children: r.children.filter((c) => isRecent(c, now)),
      missions: r.missions.filter((m) => m.pieces.some((p) => (p.child && isRecent(p.child, now)) || p.pr)),
    }))
    .filter((r) => r.parents.length || r.children.length || r.missions.length)
  return { ...snap, repos }
}

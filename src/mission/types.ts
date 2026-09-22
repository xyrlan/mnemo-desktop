/** `tokens`, `cache_read`, `children_tokens` come from the tokens piece (#22); snapshots from
 *  before it lack them, so read them through `parentTokens`, never directly. */
export type ParentSession = {
  session_id: string
  pid: number | null
  name: string | null
  status: string
  cwd: string
  tokens?: number
  cache_read?: number
  children_tokens?: number
}
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
  /** The parent session that dispatched this child, when known (#22). */
  parent_session?: string | null
  /** What the child's process is parked on, from `claude agents` (`permission prompt`);
   *  absent in snapshots from before #81. */
  waiting_for?: string | null
  /** The model the child respawns with (`opus[1m]`, `claude-haiku-4-5`). null is not a
   *  failed read: a lean child resolves no `--model`, so it runs on its settings' default.
   *  Absent in snapshots from before #99. */
  model?: string | null
  /** `--effort` it was dispatched with (`low`…`max`); null means the default. */
  effort?: string | null
  /** The PR this child opened, when it belongs to no contract (a piece carries its own).
   *  Absent in snapshots from before round 18. */
  pr?: Pr | null
}
/** `ci` is pass only when the PR has checks and every one of them passed (`check_verdict` in
 *  mission.rs). `draft` and `failing` are absent on a `Pr` built outside the snapshot. */
export type Pr = {
  number: number
  url: string
  state: string
  head: string
  ci: 'pass' | 'fail' | 'pending' | 'none'
  /** Opened as a draft: `gh pr merge` refuses it until it is marked ready. */
  draft?: boolean
  /** The checks that failed, by name. */
  failing?: string[]
}
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

/** What a BLOCKED child waits for: a tool it wants permission to run (answered with
 *  Aprovar / Negar through `claude attach`), or a question (answered with a reply). */
export function needKind(c: Pick<ChildSession, 'needs' | 'waiting_for'>): 'permission' | 'question' {
  if (c.waiting_for?.toLowerCase().includes('permission')) return 'permission'
  return c.needs?.startsWith('approve ') ? 'permission' : 'question'
}

/** The tool call a permission prompt asks about (`Bash: cd … && …`), without mnemo's
 *  `approve ` prefix; null when only `claude agents` knows the child is waiting. */
export function permissionAsk(c: Pick<ChildSession, 'needs'>): string | null {
  const n = c.needs?.trim()
  if (!n) return null
  return n.startsWith('approve ') ? n.slice('approve '.length) : n
}

/** Events since the user last looked; 0 when never looked so a fresh child is not a wall of badges. */
export function delta(c: Pick<ChildSession, 'id' | 'timeline_len'>, looked: Record<string, number>): number {
  const seen = looked[c.id]
  if (seen === undefined) return 0
  return Math.max(0, c.timeline_len - seen)
}

export function allChildren(snap: Snapshot): ChildSession[] {
  const seen = new Set<string>()
  const out: ChildSession[] = []
  const push = (c: ChildSession) => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    out.push(c)
  }
  for (const r of snap.repos) {
    for (const m of r.missions) for (const p of m.pieces) if (p.child) push(p.child)
    r.children.forEach(push)
  }
  return out
}

export function missionSummary(m: Mission): { withPr: number; total: number; ci: 'pass' | 'fail' | 'pending' | 'none' } {
  const prs = m.pieces.map((p) => p.pr).filter((p): p is Pr => !!p)
  const ci = prs.some((p) => p.ci === 'fail') ? 'fail' : prs.some((p) => p.ci === 'pending') ? 'pending' : prs.length ? 'pass' : 'none'
  return { withPr: prs.length, total: m.pieces.length, ci }
}

const RECENT_MS = 6 * 60 * 60 * 1000

/** A PR nobody has merged or closed yet. */
export const isOpen = (pr: Pr | null | undefined): pr is Pr => pr?.state === 'OPEN'

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
      // A child whose PR is still open is not history, however long ago it finished.
      children: r.children.filter((c) => isRecent(c, now) || isOpen(c.pr)),
      missions: r.missions.filter((m) => m.pieces.some((p) => (p.child && isRecent(p.child, now)) || p.pr)),
    }))
    .filter((r) => r.parents.length || r.children.length || r.missions.length)
  return { ...snap, repos }
}

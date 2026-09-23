import { childWord, isOpen, type ChildSession, type Mission, type Pr, type RepoGroup, type Snapshot } from '../mission/types'
import { issueOfBranch } from '../github/types'

/** Something only the user can move: a child waiting on a reply, a PR with red CI, a PR ready
 *  to merge, a contract whose pieces are all ready to land. `mission` is the contract a row
 *  belongs to, when it belongs to one: a PR a child opened outside any contract has none, and
 *  its `piece` is what the row calls that child (`#40`). */
export type Need =
  | { kind: 'blocked'; key: string; repo: RepoGroup; child: ChildSession; label: string; mission: Mission | null }
  | { kind: 'ci'; key: string; repo: RepoGroup; mission: Mission | null; piece: string; pr: Pr }
  | { kind: 'ready'; key: string; repo: RepoGroup; mission: Mission | null; piece: string; pr: Pr }
  | { kind: 'land'; key: string; repo: RepoGroup; mission: Mission }

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p

/** What a row calls a child: its contract piece (`chrome`), else the issue its branch or name
 *  carries (`#40`), else its own name or intent. Never the worktree folder: that is where the
 *  child ran, not what it is for. */
export function childLabel(c: ChildSession, piece?: string): string {
  if (piece) return piece
  const issue = issueOfBranch(c.branch) ?? issueOfBranch(c.name)
  if (issue !== null) return `#${issue}`
  if (c.name && c.name !== basename(c.cwd)) return c.name
  return c.intent ?? c.id
}

/** Drops finished children whose worktree is gone (git no longer lists it, so the snapshot has
 *  no branch for it) and the repo groups left empty: such a group is named after the dead
 *  worktree folder, not after a repo. A child whose PR is still open stays: the PR needs
 *  someone whether or not its worktree does. Pass a `pruneSnapshot` result. */
export function pruneGone(snap: Snapshot): Snapshot {
  const repos = snap.repos
    .map((r) => ({ ...r, children: r.children.filter((c) => c.live || !!c.branch || isOpen(c.pr)) }))
    .filter((r) => r.parents.length || r.children.length || r.missions.length)
  return { ...snap, repos }
}

/** Blocked children first (they stall work), then red CI, then PRs ready to merge, then
 *  landable contracts; snapshot order within each. Only open PRs are red CI or ready to
 *  merge, a contract piece's or any other child's alike; ready means every check passed, and
 *  a draft is ready too (its merge marks it ready first). A landable contract's green PRs are
 *  one `land`, not one merge each. Pass a pruned snapshot: stale children never need you. */
export function needsYou(snap: Snapshot): Need[] {
  const blocked: Need[] = []
  const ci: Need[] = []
  const ready: Need[] = []
  const land: Need[] = []
  const seen = new Set<string>()
  const block = (repo: RepoGroup, c: ChildSession, label: string, mission: Mission | null) => {
    if (seen.has(c.id) || childWord(c) !== 'BLOCKED') return
    seen.add(c.id)
    blocked.push({ kind: 'blocked', key: `blocked:${c.id}`, repo, child: c, label, mission })
  }
  const prs = new Set<string>()
  const pr = (repo: RepoGroup, pr: Pr | null | undefined, piece: string, mission: Mission | null, landable = false) => {
    // A merged or closed PR is history: whatever its last rollup said, it needs nobody.
    if (!isOpen(pr)) return
    const key = `${repo.root}#${pr.number}`
    if (prs.has(key)) return
    prs.add(key)
    if (pr.ci === 'fail') ci.push({ kind: 'ci', key: `ci:${key}`, repo, mission, piece, pr })
    else if (!landable && pr.ci === 'pass') ready.push({ kind: 'ready', key: `ready:${key}`, repo, mission, piece, pr })
  }
  for (const repo of snap.repos) {
    for (const m of repo.missions) {
      for (const p of m.pieces) {
        if (p.child) block(repo, p.child, childLabel(p.child, p.name), m)
        pr(repo, p.pr, p.name, m, m.landable)
      }
      if (m.landable) land.push({ kind: 'land', key: `land:${m.contract_path}`, repo, mission: m })
    }
    for (const c of repo.children) {
      block(repo, c, childLabel(c), null)
      pr(repo, c.pr, childLabel(c), null)
    }
  }
  return [...blocked, ...ci, ...ready, ...land]
}

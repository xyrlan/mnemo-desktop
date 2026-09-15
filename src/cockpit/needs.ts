import { childWord, type ChildSession, type Mission, type Pr, type RepoGroup, type Snapshot } from '../mission/types'

/** Something only the user can move: a child waiting on a reply, a PR with red CI, a
 *  contract whose pieces are all ready to land. */
export type Need =
  | { kind: 'blocked'; key: string; repo: RepoGroup; child: ChildSession; label: string }
  | { kind: 'ci'; key: string; repo: RepoGroup; mission: Mission; piece: string; pr: Pr }
  | { kind: 'land'; key: string; repo: RepoGroup; mission: Mission }

/** Blocked children first (they stall work), then red CI, then landable contracts; snapshot
 *  order within each. Pass a pruned snapshot: stale children never need you. */
export function needsYou(snap: Snapshot): Need[] {
  const blocked: Need[] = []
  const ci: Need[] = []
  const land: Need[] = []
  const seen = new Set<string>()
  const block = (repo: RepoGroup, c: ChildSession, label: string) => {
    if (seen.has(c.id) || childWord(c) !== 'BLOCKED') return
    seen.add(c.id)
    blocked.push({ kind: 'blocked', key: `blocked:${c.id}`, repo, child: c, label })
  }
  for (const repo of snap.repos) {
    for (const m of repo.missions) {
      for (const p of m.pieces) {
        if (p.child) block(repo, p.child, p.name)
        if (p.pr?.ci === 'fail') ci.push({ kind: 'ci', key: `ci:${repo.root}#${p.pr.number}`, repo, mission: m, piece: p.name, pr: p.pr })
      }
      if (m.landable) land.push({ kind: 'land', key: `land:${m.contract_path}`, repo, mission: m })
    }
    for (const c of repo.children) block(repo, c, c.name ?? c.intent ?? c.id)
  }
  return [...blocked, ...ci, ...land]
}

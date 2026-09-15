import { childWord, type ChildSession, type Mission, type Piece, type Pr, type RepoGroup } from '../mission/types'

/** Mirrors `src-tauri/src/github.rs`. */
export type Auth = { installed: boolean; logged: boolean; login: string | null; scopes: string[] }
export type IssuePiece = { contract_path: string; piece: string }
export type Issue = {
  number: number
  title: string
  labels: string[]
  assignees: string[]
  state: string
  url: string
  updated_at: string
  milestone: string | null
  /** PRs that close the issue. */
  prs: number[]
  /** Contract pieces whose section names the issue. */
  pieces: IssuePiece[]
}
export type BoardItem = { id: string; title: string; number: number | null; url: string | null; kind: 'Issue' | 'PullRequest' | 'DraftIssue' | string }
export type BoardColumn = { name: string; items: BoardItem[] }
export type Board = { title: string; url: string; columns: BoardColumn[] }

/** `gh_project` rejects with this when the token lacks the `project` scope. */
export const NEEDS_SCOPE = 'needs_scope'
export const SCOPE_FIX = 'gh auth refresh -s project'
/** How many recent issues (after the label filter) the cockpit shows beside the linked ones. */
export const RECENT = 10

/** `fix/issue-45` (what `mnemo dispatch 45` creates), `feat/issue-45-x`: the issue number. */
export function issueOfBranch(branch: string | null | undefined): number | null {
  const m = branch?.match(/(?:^|\/)issue-(\d+)(?:$|[-/])/)
  return m ? Number(m[1]) : null
}

/** What already works on an issue: children on its branch or dispatched for a contract piece
 *  that names it, and PRs (a piece's, one on its branch, or one that closes it). `closing`
 *  keeps the closing PR numbers the snapshot does not know. */
export type IssueLink = {
  children: ChildSession[]
  pieces: { mission: Mission; piece: Piece }[]
  prs: Pr[]
  closing: number[]
}

/** Links for the issues that have any; an issue without a child or PR is absent. */
export function linkIssues(repo: RepoGroup, issues: Issue[]): Map<number, IssueLink> {
  const out = new Map<number, IssueLink>()
  const prs = new Map<number, Pr>()
  for (const m of repo.missions) for (const p of m.pieces) if (p.pr) prs.set(p.pr.number, p.pr)
  for (const i of issues) {
    const l: IssueLink = { children: [], pieces: [], prs: [], closing: [] }
    const addPr = (pr: Pr) => void (l.prs.some((x) => x.number === pr.number) || l.prs.push(pr))
    for (const c of repo.children) if (issueOfBranch(c.branch) === i.number) l.children.push(c)
    for (const m of repo.missions) {
      for (const p of m.pieces) {
        const named = i.pieces.some((x) => x.contract_path === m.contract_path && x.piece === p.name)
        const onBranch = issueOfBranch(p.child?.branch ?? p.branch) === i.number || issueOfBranch(p.pr?.head) === i.number
        if ((named || onBranch) && (p.child || p.pr)) l.pieces.push({ mission: m, piece: p })
        if ((named || onBranch) && p.pr) addPr(p.pr)
      }
    }
    for (const n of i.prs) {
      const pr = prs.get(n)
      if (pr) addPr(pr)
      else l.closing.push(n)
    }
    if (l.children.length || l.pieces.length || l.prs.length || l.closing.length) out.set(i.number, l)
  }
  return out
}

/** One word for the most urgent thing linked to an issue, for a card chip. */
export function linkWord(l: IssueLink | undefined): string | null {
  if (!l) return null
  const kids = [...l.children, ...l.pieces.map((p) => p.piece.child).filter((c): c is ChildSession => !!c)]
  const words = kids.map(childWord)
  for (const w of ['BLOCKED', 'active', 'stalled'] as const) if (words.includes(w)) return w === 'active' ? 'child active' : `child ${w}`
  const pr = l.prs.find((p) => p.ci === 'fail') ?? l.prs[0]
  if (pr) return `PR #${pr.number}${pr.ci === 'fail' ? ' CI ✗' : pr.ci === 'pass' ? ' ✓' : ''}`
  if (l.closing.length) return `PR #${l.closing[0]}`
  if (words.includes('done')) return 'child done'
  return words.length ? 'child stopped' : null
}

export function labelsOf(issues: Issue[]): string[] {
  return [...new Set(issues.flatMap((i) => i.labels))].sort((a, b) => a.localeCompare(b))
}

/** Issues carrying any of `labels`; no labels keeps every issue. */
export function filterByLabels(issues: Issue[], labels: string[]): Issue[] {
  return labels.length ? issues.filter((i) => i.labels.some((l) => labels.includes(l))) : issues
}

const newest = (a: Issue, b: Issue) => b.updated_at.localeCompare(a.updated_at) || b.number - a.number

/** What the cockpit shows: every issue with a child or PR, then the `n` most recently updated
 *  of the rest that pass the label filter. */
export function shownIssues(issues: Issue[], links: Map<number, IssueLink>, labels: string[], n = RECENT): Issue[] {
  const linked = issues.filter((i) => links.has(i.number)).sort(newest)
  const recent = filterByLabels(issues.filter((i) => !links.has(i.number)), labels).sort(newest).slice(0, n)
  return [...linked, ...recent]
}

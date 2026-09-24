import { githubError, type HomeRepo, type HomeSnapshot, type Pr } from '../home/types'
import type { Issue, IssueLink } from '../github/types'

/** One repo's group in Tasks: its open issues and PRs as Home's last GitHub read has them, the
 *  ones the query keeps, and why `gh` could not read it, if it could not. */
export type TaskRepo = { repo: HomeRepo; issues: Issue[]; prs: Pr[]; error: string | null }

/** Every term of `q` is found in the item's number (`#12` or `12`), title, labels or repo name. */
function hit(q: string[], hay: string) {
  return q.every((t) => hay.includes(t))
}
const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** The repos Tasks lists, in Home's order. Hidden repos stay hidden and unresolved ones stay out:
 *  their issues were never read, and reading one runs git where macOS may ask. A repo is listed
 *  when it has something to show — an issue, a PR, or `gh`'s reason it could not read it — and,
 *  under a query, only when something in it matches. */
export function taskRepos(snap: HomeSnapshot, query: string): TaskRepo[] {
  const q = terms(query)
  const out: TaskRepo[] = []
  for (const repo of snap.repos) {
    if (repo.hidden || repo.unresolved) continue
    const name = repo.name.toLowerCase()
    const issues = (repo.issues ?? []).filter((i) => hit(q, `#${i.number} ${i.title} ${i.labels.join(' ')} ${name}`.toLowerCase()))
    const prs = (repo.prs ?? []).filter((p) => hit(q, `#${p.number} ${p.title} ${p.state} ${name}`.toLowerCase()))
    const error = githubError(snap.errors, repo.name)
    if (issues.length || prs.length || (error && !q.length)) out.push({ repo, issues, prs, error })
  }
  return out
}

/** Open issues and PRs across the repos Tasks can list, before any query. */
export function totals(snap: HomeSnapshot): { issues: number; prs: number } {
  let issues = 0
  let prs = 0
  for (const r of snap.repos) {
    if (r.hidden || r.unresolved) continue
    issues += r.issues?.length ?? 0
    prs += r.prs?.length ?? 0
  }
  return { issues, prs }
}

/** The issues of a group that can still be dispatched, in the order shown: one that a child, a
 *  contract piece or a PR already works on is not, so a batch never dispatches it twice. */
export const dispatchable = (issues: Issue[], links: Map<number, IssueLink>) => issues.filter((i) => !links.has(i.number)).map((i) => i.number)

/** A PR's checks as a tone and words; null when it has none. */
export function checksOf(pr: Pr): { tone: 'pass' | 'fail' | 'pending'; label: string } | null {
  if (pr.checks === 'pass') return { tone: 'pass', label: 'checks pass' }
  if (pr.checks === 'fail') return { tone: 'fail', label: 'checks fail' }
  if (pr.checks === 'pending') return { tone: 'pending', label: 'checks running' }
  return null
}

/** The values `mnemo dispatch` accepts for each flag; empty leaves the flag off. Closed sets,
 *  as the board had them: these words become a command's arguments. */
export const MODELS = ['', 'haiku', 'sonnet', 'opus']
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']
export const MAY = ['', 'pr', 'push', 'none']

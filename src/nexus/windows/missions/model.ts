import { jobState, type Job } from '../../../cockpit/store'
import type { IssueLink } from '../../../github/types'
import type { HomeRepo } from '../../../home/types'
import type { ChildSession, Mission } from '../../../mission/types'
import { norm, samePath } from '../../../path/path'

/** The MISSIONS window's pure part (spec `2026-10-15-nexus-app-design.md`, Q5): which repo it shows,
 *  which robot an issue in flight links to, the batch a pick makes, the contracts a repo holds and
 *  how a dispatch it started stands. The data is the Tasks view's (`src/tasks/model.ts`). */

/** The repo the window opens on: the one `root` names, if Home lists it, else every repo (null). */
export function initialRepo(repos: HomeRepo[], root: string | undefined): string | null {
  if (!root) return null
  return repos.find((r) => samePath(r.root, root))?.root ?? null
}

/** The robot an issue in flight links to: its live child first, else its newest one; null when only
 *  a PR works on it. A robot's id on the ship is its child's `id`. */
export function robotOf(link: IssueLink | undefined): ChildSession | null {
  if (!link) return null
  const kids = [...link.children, ...link.pieces.map((p) => p.piece.child).filter((c): c is ChildSession => !!c)]
  if (!kids.length) return null
  return kids.find((c) => c.live) ?? [...kids].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]
}

/** A click on an issue's pick: it toggles that issue; with shift, every dispatchable issue from the
 *  last pick through this one joins. `order` is the dispatchable issues in the order shown. */
export function pick(picked: number[], order: number[], n: number, shift: boolean): number[] {
  const last = picked[picked.length - 1]
  if (shift && last !== undefined && order.includes(last) && order.includes(n)) {
    const [a, b] = [order.indexOf(last), order.indexOf(n)].sort((x, y) => x - y)
    const range = order.slice(a, b + 1)
    return [...picked, ...range.filter((x) => !picked.includes(x))]
  }
  return picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]
}

/** Where a repo keeps its decomposition contracts, repo-relative: mnemo's own place first. */
export const CONTRACT_DIRS = ['docs/superpowers/contracts', 'docs/contracts']

/** A contract a repo holds: its repo-relative path, and the mission already dispatched from it, if
 *  the snapshot has one (its children may still be running). */
export type ContractFile = { path: string; mission: Mission | null }

/** The `.md` files found in each of `CONTRACT_DIRS` (by directory, as listed), newest name first
 *  (contracts are named by date), each with the mission dispatched from it. */
export function contractFiles(root: string, found: { dir: string; names: string[] }[], missions: Mission[]): ContractFile[] {
  const paths = found.flatMap(({ dir, names }) => names.filter((n) => n.toLowerCase().endsWith('.md')).map((n) => `${dir}/${n}`))
  const byName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  paths.sort((a, b) => byName(b).localeCompare(byName(a)) || a.localeCompare(b))
  return paths.map((path) => ({ path, mission: missionOf(root, path, missions) }))
}

/** The mission the snapshot has for the contract at repo-relative `path`, whose `contract_path` is
 *  absolute; compared as paths, so a Windows root matches too. */
export function missionOf(root: string, path: string, missions: Mission[]): Mission | null {
  const want = norm(`${root}/${path.trim()}`)
  return missions.find((m) => norm(m.contract_path) === want) ?? null
}

/** A typed contract path `mnemo dispatch --contract` can take: repo-relative, no `..`. */
export function contractPathError(path: string): string | null {
  const p = path.trim()
  if (!p) return 'Name a contract.'
  if (/^([a-zA-Z]:)?[\\/]/.test(p) || p.startsWith('~')) return 'Give the path inside the repo, such as docs/superpowers/contracts/round.md.'
  if (p.split(/[\\/]/).includes('..')) return 'The contract must be inside the repo.'
  if (!p.toLowerCase().endsWith('.md')) return 'A contract is a Markdown file (.md).'
  return null
}

/** How a dispatch the window started stands, as one line: running, or what it ended with (its
 *  error, else the last thing `mnemo dispatch` printed). */
export function jobLine(j: Job | undefined): { tone: 'run' | 'ok' | 'fail'; text: string } {
  if (!j) return { tone: 'run', text: 'starting…' }
  const last = [...j.lines].reverse().find((l) => l.line.trim())?.line.trim() ?? ''
  const state = jobState(j)
  if (state === 'running') return { tone: 'run', text: last || 'running…' }
  if (state === 'ok') return { tone: 'ok', text: last || 'done' }
  return { tone: 'fail', text: j.error ?? (last || `it exited ${j.code ?? 'on a signal'}`) }
}

/** `~/…` for a path under a home folder, as the window shows paths. */
export const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[a-zA-Z]:\\Users\\[^\\]+/, '~')

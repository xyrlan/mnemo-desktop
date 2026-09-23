import type { Pr as MissionPr } from '../../mission/types'
import type { Pr } from '../types'

/** Mirrors `src-tauri/src/review.rs`. */
export type LineKind = 'ctx' | 'add' | 'del' | 'note'
/** `old`/`new`: the line's number on each side it is in. `cut`: the text stops at the
 *  backend's per-line limit (a minified bundle is one line). */
export type DiffLine = { kind: LineKind; old: number | null; new: number | null; text: string; cut?: boolean }
export type Hunk = { header: string; lines: DiffLine[] }
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified'
/** `lines`: every diff line the file has, kept or not. `truncated`: some were dropped past the
 *  backend's total, so the rest is only on GitHub. */
export type FileDiff = {
  path: string
  old_path: string | null
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  hunks: Hunk[]
  lines: number
  truncated?: boolean
}
/** `state` is `gh`'s own (`OPEN`); `diff_error` says why `files` carry no hunks. */
export type Review = { head: string; base: string; state: string; draft: boolean; files: FileDiff[]; diff_error: string | null; truncated: boolean }

/** Lines drawn when the view opens, over every file. Files open in order while they fit;
 *  the rest start folded, one click away. A child's PR is a few hundred lines and opens whole. */
export const OPEN_BUDGET = 1500
/** Lines one open file draws before "show more": a file of thousands stays a click per page. */
export const PAGE = 500

/** Files nobody reads line by line: lock files, minified and generated output. They start
 *  folded whatever their size. */
const GENERATED = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$|\.snap$/

export const isGenerated = (path: string) => GENERATED.test(path)

/** The files that start open: in order, each only if it still fits in `budget` lines. */
export function initiallyOpen(files: FileDiff[], budget = OPEN_BUDGET): Set<string> {
  const open = new Set<string>()
  let used = 0
  for (const f of files) {
    const n = f.hunks.reduce((s, h) => s + h.lines.length, 0)
    if (!n || isGenerated(f.path) || used + n > budget) continue
    used += n
    open.add(f.path)
  }
  return open
}

/** `+12 −3`, with the file count when there are several. */
export function totals(files: FileDiff[]): { files: number; additions: number; deletions: number } {
  return files.reduce((t, f) => ({ files: t.files + 1, additions: t.additions + f.additions, deletions: t.deletions + f.deletions }), { files: 0, additions: 0, deletions: 0 })
}

/** The PR as `mergePr` takes it (`src/mission/types.ts`), in the shape the cockpit's own PR
 *  fetch gives it: `gh`'s state and head branch from the review read, checks as the lens last
 *  read them. The merge's gating lives behind `mergePr`, not here. */
export function mergeTarget(pr: Pr, review: Pick<Review, 'head' | 'state'>): MissionPr {
  return { number: pr.number, url: pr.url, state: review.state, head: review.head, ci: pr.checks }
}

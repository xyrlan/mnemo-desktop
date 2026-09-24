// adapted from stablyai/orca components/right-sidebar/FileExplorerRow.tsx (the status letter and colour it draws) and assets/main.css (the git-decoration tokens)
import type { Change } from '../commit/client'
import type { GitFileStatus } from './types'

export const STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
}

/** The tokens live in explorer.css, Orca's values. */
export const STATUS_COLORS: Record<GitFileStatus, string> = {
  modified: 'var(--git-decoration-modified)',
  added: 'var(--git-decoration-added)',
  deleted: 'var(--git-decoration-deleted)',
  renamed: 'var(--git-decoration-renamed)',
  copied: 'var(--git-decoration-copied)',
  untracked: 'var(--git-decoration-untracked)',
  conflicted: 'var(--git-decoration-deleted)',
}

const LETTERS: Record<string, GitFileStatus> = { M: 'modified', T: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied' }

/** A change as the row draws it: the worktree's letter over the index's, since that is the file
 *  on disk. */
export function statusOf(c: Change): GitFileStatus | null {
  if (c.conflicted) return 'conflicted'
  if (c.index === '?' || c.worktree === '?') return 'untracked'
  const letter = c.worktree !== '.' ? c.worktree : c.index
  return LETTERS[letter] ?? null
}

export function fileStatuses(changes: readonly Change[]): Map<string, GitFileStatus> {
  const out = new Map<string, GitFileStatus>()
  for (const c of changes) {
    const s = statusOf(c)
    if (s) out.set(c.path, s)
  }
  return out
}

/** Which status a folder takes when its files disagree: the one most worth a look. */
const RANK: GitFileStatus[] = ['conflicted', 'modified', 'deleted', 'added', 'renamed', 'copied', 'untracked']

/** Each folder above a changed file, with the status it is drawn in. */
export function folderStatuses(files: ReadonlyMap<string, GitFileStatus>): Map<string, GitFileStatus> {
  const out = new Map<string, GitFileStatus>()
  for (const [path, status] of files) {
    let at = path
    for (let i = at.lastIndexOf('/'); i > 0; i = at.lastIndexOf('/')) {
      at = at.slice(0, i)
      const had = out.get(at)
      if (!had || RANK.indexOf(status) < RANK.indexOf(had)) out.set(at, status)
    }
  }
  return out
}

/** `git ls-files --others --ignored --exclude-standard --directory`: one path per line, a folder
 *  with a trailing `/`. */
export function parseIgnored(lines: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const line of lines) {
    const p = line.replace(/\/+$/, '')
    if (p) out.add(p)
  }
  return out
}

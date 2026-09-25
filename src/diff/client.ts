import { invoke } from '@tauri-apps/api/core'

/** One changed file of a worktree, as `worktree_diff.rs` reports it. */
export type ChangedFile = {
  /** Relative to the tree's top level, `/`-separated. */
  path: string
  /** Where a renamed file was in `HEAD`. */
  oldPath: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  /** Lines added and removed against `HEAD`; null for a binary file or when git could not say. */
  additions: number | null
  deletions: number | null
  binary: boolean
}

export type ChangeList = {
  /** The tree's top level, which every `path` is relative to. */
  root: string
  files: ChangedFile[]
  /** More files changed than the core lists. */
  truncated: boolean
  /** What the files are compared to when it is a branch's base (`main @ 1a2b3c4`), not `HEAD`. */
  base?: string | null
}

/** A file's two sides: `HEAD`'s and the working tree's. Both empty when either is binary or
 *  too large to diff. */
export type FileSides = { original: string; modified: string; binary: boolean; tooLarge: boolean }

export interface DiffClient {
  /** The uncommitted changes of the tree `worktree` is in: staged, unstaged and untracked. With
   *  `base` (empty: the repo's default branch), everything since the branch was cut from it: its
   *  commits as well. */
  files(worktree: string, base?: string): Promise<ChangeList>
  /** Both sides of one of them; `oldPath` for a renamed file. */
  sides(worktree: string, file: string, oldPath: string | null, base?: string): Promise<FileSides>
}

export const tauriDiff: DiffClient = {
  files: (worktree, base) => invoke<ChangeList>('worktree_diff_files', { worktree, base }),
  sides: (worktree, file, oldPath, base) => invoke<FileSides>('worktree_diff_file', { worktree, file, oldPath, base }),
}

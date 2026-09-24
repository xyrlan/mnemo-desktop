import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type ScmArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'
export type ScmFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

/** One row of the panel, as `source_control.rs` reads it from `git status`: a file changed in
 *  the index and again in the tree is two entries, one per area. */
export type ScmEntry = {
  /** Relative to the tree's top level, `/`-separated. */
  path: string
  /** Where a renamed or copied file came from. */
  oldPath: string | null
  area: ScmArea
  status: ScmFileStatus
  /** Lines added and removed in this area; null for a binary file or when git could not say. */
  added: number | null
  removed: number | null
}

export type ScmStatus = {
  /** The tree's top level, which every `path` is relative to. */
  root: string
  /** null on a detached HEAD. */
  branch: string | null
  entries: ScmEntry[]
  /** More changes than the core lists. */
  truncated: boolean
}

/** What the panel asks of git. Every call rejects with what git said. */
export interface ScmClient {
  status(worktree: string): Promise<ScmStatus>
  /** Stages `paths` as they are on disk; staging a conflicted file marks it resolved. */
  stage(worktree: string, paths: string[]): Promise<void>
  /** Back to `HEAD`'s version in the index, the files left as they are. */
  unstage(worktree: string, paths: string[]): Promise<void>
  /** Drops the unstaged changes of `tracked` and deletes the untracked files `untracked`. */
  discard(worktree: string, tracked: string[], untracked: string[]): Promise<void>
  /** Watches `worktree` (none: nothing), in place of the tree watched before. Rejects when the
   *  system cannot watch that many folders. */
  watch(worktree: string | null): Promise<void>
  /** Calls `on` with the watched tree's top level when its changes may have changed. */
  onChanged(on: (root: string) => void): Promise<() => void>
}

export const tauriScm: ScmClient = {
  status: (worktree) => invoke<ScmStatus>('source_control_status', { worktree }),
  stage: (worktree, paths) => invoke<void>('source_control_stage', { worktree, paths }),
  unstage: (worktree, paths) => invoke<void>('source_control_unstage', { worktree, paths }),
  discard: (worktree, tracked, untracked) => invoke<void>('source_control_discard', { worktree, tracked, untracked }),
  watch: (worktree) => invoke<void>('source_control_watch', { worktree }),
  onChanged: (on) => listen<string>('source-control://changed', (e) => on(e.payload)),
}

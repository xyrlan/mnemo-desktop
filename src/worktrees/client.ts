import { invoke } from '@tauri-apps/api/core'

/** One worktree of a repo, as `worktree.rs` reports it. */
export type WorktreeInfo = {
  path: string
  /** null on a detached HEAD. */
  branch: string | null
  /** The commit checked out, in full. */
  head: string
  /** The main checkout; `listWorktrees` puts it first. */
  isMain: boolean
  /** Holds `.mnemo-child-profile/dispatch.json`: a `mnemo dispatch` child. */
  dispatched: boolean
  /** Changes or untracked files: `removeWorktree` refuses it without `force`. */
  dirty: boolean
  /** The setup command's job id while it runs; its output comes as `job-line` / `job-exit`. */
  setupJob: string | null
}

/** Every worktree of the repo `repo` is in (any of its trees works), the main checkout first. */
export const listWorktrees = (repo: string): Promise<WorktreeInfo[]> => invoke<WorktreeInfo[]>('worktree_list', { repo })

/** Creates the sibling `<repo>-wt-<name>` on branch `name` (checked out when it exists, else
 *  started at `base` or HEAD), copies the gitignored files `.worktreeinclude` names, and starts
 *  `setup` there. Resolves once the tree exists; setup reports on `setupJob`. */
export const createWorktree = (repo: string, name: string, opts: { base?: string; setup?: string } = {}): Promise<WorktreeInfo> =>
  invoke<WorktreeInfo>('worktree_create', { repo, name, base: opts.base ?? null, setup: opts.setup ?? null })

/** Removes a worktree, keeping its branch. Rejects for the main checkout, while setup runs, and
 *  (without `force`) for a dirty tree. */
export const removeWorktree = (path: string, force = false): Promise<void> => invoke<void>('worktree_remove', { path, force })

/** A tree other than the main checkout, as cleaning up sees it. */
export type CleanupTree = WorktreeInfo & {
  /** Its HEAD is in the default branch (local or the remote's): none of its commits would be
   *  lost. True too for a tree that never made one. */
  merged: boolean
}

export type CleanupFacts = {
  /** What `merged` is measured against (`origin/main`); null when there is nothing to measure
   *  against, and then nothing is `merged`. */
  base: string | null
  /** Every tree of the repo but the main checkout. */
  trees: CleanupTree[]
}

/** What cleaning up stale worktrees needs to know of the repo `repo` is in. */
export const cleanupFacts = (repo: string): Promise<CleanupFacts> => invoke<CleanupFacts>('worktree_cleanup_facts', { repo })

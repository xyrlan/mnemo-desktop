import { invoke } from '@tauri-apps/api/core'

/** One changed path, as `commit.rs` reads it from `git status --porcelain=v2`. */
export type Change = {
  path: string
  /** The path it was renamed or copied from. */
  origPath: string | null
  /** Git's status letters: index, then worktree (`.` unchanged, `?` untracked). */
  index: string
  worktree: string
  /** Unmerged: resolve it before committing. */
  conflicted: boolean
}

export type Status = {
  /** The worktree's top folder. */
  root: string
  /** null on a detached HEAD. */
  branch: string | null
  /** The remote a push goes to; null when the repo has none. */
  remote: string | null
  /** The branch exists on the remote already. */
  published: boolean
  /** Commits a push would send. */
  ahead: number
  /** Commits on the remote branch this one lacks. */
  behind: number
  /** The branch a pull request targets. */
  base: string
  /** No commit yet. */
  unborn: boolean
  changes: Change[]
}

export type Committed = { sha: string; summary: string }
export type PullRequest = { number: number; url: string; state: string; title: string }
export type PrDraft = { title: string; body: string }

/** What the composer asks of git, `gh` and `claude`. Every call rejects with what they said. */
export type CommitClient = {
  status(worktree: string): Promise<Status>
  /** A commit message for `paths`, written by `claude -p` from their diff. */
  message(worktree: string, paths: string[]): Promise<string>
  /** Commits exactly `paths`; anything else staged stays staged. */
  commit(worktree: string, paths: string[], message: string): Promise<Committed>
  push(worktree: string): Promise<string>
  /** The branch's pull request, when it has one. */
  findPr(worktree: string): Promise<PullRequest | null>
  /** A title and body for a PR into `base`, written by `claude -p` from the branch's commits. */
  draftPr(worktree: string, base: string): Promise<PrDraft>
  createPr(worktree: string, pr: { base: string; title: string; body: string; draft: boolean }): Promise<PullRequest>
}

export const tauriCommit: CommitClient = {
  status: (worktree) => invoke<Status>('commit_status', { worktree }),
  message: (worktree, paths) => invoke<string>('commit_message', { worktree, paths }),
  commit: (worktree, paths, message) => invoke<Committed>('commit_create', { worktree, paths, message }),
  push: (worktree) => invoke<string>('commit_push', { worktree }),
  findPr: (worktree) => invoke<PullRequest | null>('commit_pr_find', { worktree }),
  draftPr: (worktree, base) => invoke<PrDraft>('commit_pr_draft', { worktree, base }),
  createPr: (worktree, pr) => invoke<PullRequest>('commit_pr_create', { worktree, ...pr }),
}

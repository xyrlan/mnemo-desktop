import { invoke } from '@tauri-apps/api/core'

/** A worktree branch's pull request, as `checks.rs` reads it from `gh pr view`. */
export type ChecksPr = {
  number: number
  title: string
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  base: string
  head: string
  /** The commit the checks ran on: the only one a merge from here lands. */
  headSha: string
  author: string | null
  /** `MERGEABLE`, `CONFLICTING` or `UNKNOWN`. */
  mergeable: string
  /** GitHub's `mergeStateStatus`: `CLEAN`, `BLOCKED`, `BEHIND`, `DIRTY`, `UNSTABLE`, … */
  mergeState: string
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; null when no review is asked for. */
  reviewDecision: string | null
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
}

/** One entry of the PR's check rollup: a check run, or a commit status. */
export type Check = {
  name: string
  workflow: string | null
  /** The rule the whole app reads CI by (`mission::check_verdict`). */
  verdict: 'pass' | 'fail' | 'pending'
  /** `queued`, `in_progress`, `completed`, or `pending` for a commit status still running. */
  status: string
  /** GitHub's conclusion, lowercased; null while it runs. */
  conclusion: string | null
  url: string | null
  description: string | null
  startedAt: string | null
  completedAt: string | null
  /** The Actions job behind it; only such a check has details to read. */
  jobId: number | null
}

export type Comment = {
  author: string
  body: string
  createdAt: string
  url: string | null
  /** A review's verdict, for a review's own text; null for a comment. */
  review: string | null
  /** The code a thread's comment is on: the end of its diff hunk. */
  diffHunk: string | null
}

export type Thread = {
  id: string
  path: string
  line: number | null
  resolved: boolean
  outdated: boolean
  comments: Comment[]
}

export type ChecksView = {
  root: string
  /** null on a detached HEAD. */
  branch: string | null
  /** null when the branch has no pull request. */
  pr: ChecksPr | null
  /** Failing first, then running, then the rest. */
  checks: Check[]
  /** Unresolved first. */
  threads: Thread[]
  /** The conversation's comments and the reviews' own texts, oldest first. */
  comments: Comment[]
  threadsError: string | null
  mergeMethods: MergeMethod[]
}

export type Step = { number: number; name: string; status: string; conclusion: string | null }
export type Annotation = { path: string; line: number | null; level: string; title: string | null; message: string }

/** The Actions job behind a check. */
export type CheckDetails = {
  jobId: number
  name: string
  status: string
  conclusion: string | null
  url: string | null
  startedAt: string | null
  completedAt: string | null
  steps: Step[]
  annotations: Annotation[]
  /** The failed log's last lines, up to its last error. */
  logTail: string | null
  logError: string | null
}

export type MergeMethod = 'squash' | 'merge' | 'rebase'
export type Merged = { merged: boolean; message: string }

/** What the Checks tab asks of `gh`. Every call rejects with what `gh` said. */
export type ChecksClient = {
  read(worktree: string): Promise<ChecksView>
  details(worktree: string, url: string): Promise<CheckDetails>
  /** Merges only if the PR, read again now, is open, green and still at `sha`. */
  merge(worktree: string, number: number, method: MergeMethod, sha: string): Promise<Merged>
  ready(worktree: string, number: number): Promise<void>
}

export const tauriChecks: ChecksClient = {
  read: (worktree) => invoke<ChecksView>('checks_read', { worktree }),
  details: (worktree, url) => invoke<CheckDetails>('checks_details', { worktree, url }),
  merge: (worktree, number, method, sha) => invoke<Merged>('checks_merge', { worktree, number, method, sha }),
  ready: (worktree, number) => invoke<void>('checks_ready', { worktree, number }),
}

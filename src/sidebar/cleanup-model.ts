// adapted from stablyai/orca components/workspace-cleanup/workspace-cleanup-candidate-row-data.ts
// and workspace-cleanup-candidate-labels.ts (MIT, 122b8c25): what makes a workspace a candidate
// and what its pills say, narrowed to what mnemo knows of a worktree.
import type { AgentNode, PrNode, RepoNode, WorktreeNode } from '../fleet/types'
import type { CleanupFacts } from '../worktrees/client'
import { norm } from './model'

/** Why a worktree has run its course: its commits are all in the default branch, or its PR was
 *  merged or closed. */
export type StaleReason = 'pr-merged' | 'pr-closed' | 'merged'

/** Why a worktree stays: it has changes, an agent at work, another program running in it, setup
 *  running, commits no remote has though its PR ended (`unpushed`), nothing that says it is done
 *  (`unmerged`), or git did not list it (`unchecked`). */
export type KeepReason = 'changes' | 'agent' | 'program' | 'setup' | 'unpushed' | 'unmerged' | 'unchecked'

export type Candidate = {
  path: string
  name: string
  branch: string | null
  kind: WorktreeNode['kind']
  repoRoot: string
  repoName: string
  pr: PrNode | null
  /** What `merged` was measured against (`origin/main`). */
  base: string | null
  stale: StaleReason[]
  keep: KeepReason[]
  /** What runs in it, as git's facts name them (`node (4123)`). */
  programs: string[]
}

/** An agent that is working or waiting on you: removing its worktree would cut it off. */
export const isLive = (a: Pick<AgentNode, 'state'>) => a.state === 'working' || a.state === 'needs-you'

/** One of `repo`'s worktrees, judged by the fleet's view of it and git's `facts`. The main
 *  checkout is never a candidate; callers leave it out. */
export function classify(repo: RepoNode, tree: WorktreeNode, facts: CleanupFacts): Candidate {
  const fact = facts.trees.find((t) => norm(t.path) === tree.path)
  const stale: StaleReason[] = []
  if (tree.pr?.state === 'merged') stale.push('pr-merged')
  if (tree.pr?.state === 'closed') stale.push('pr-closed')
  if (fact?.merged) stale.push('merged')
  const keep: KeepReason[] = []
  if (!fact) keep.push('unchecked')
  if (fact?.dirty) keep.push('changes')
  if (tree.agents.some(isLive)) keep.push('agent')
  if (fact?.programs.length) keep.push('program')
  if (fact?.setupJob) keep.push('setup')
  // Done by its PR alone: commits made since, which no remote has, are work only this machine holds.
  if (stale.length > 0 && fact?.unpushed) keep.push('unpushed')
  if (stale.length === 0 && fact) keep.push('unmerged')
  return {
    path: tree.path,
    name: tree.name,
    branch: tree.branch,
    kind: tree.kind,
    repoRoot: repo.root,
    repoName: repo.name,
    pr: tree.pr,
    base: facts.base,
    stale,
    keep,
    programs: fact?.programs ?? [],
  }
}

/** Nothing would be lost by removing it: done by one measure, kept by none. */
export const isStale = (c: Pick<Candidate, 'stale' | 'keep'>) => c.stale.length > 0 && c.keep.length === 0

export function staleLabel(reason: StaleReason, c: Pick<Candidate, 'pr' | 'base'>): string {
  if (reason === 'pr-merged') return `PR #${c.pr?.number} merged`
  if (reason === 'pr-closed') return `PR #${c.pr?.number} closed`
  return c.base ? `In ${c.base}` : 'Merged'
}

const KEPT_LABEL: Record<KeepReason, (n: number) => string> = {
  changes: (n) => `${n} with changes`,
  agent: (n) => `${n} with an agent at work`,
  program: (n) => `${n} with a program running in it`,
  setup: (n) => `${n} still setting up`,
  unpushed: (n) => `${n} with unpushed commits`,
  unmerged: (n) => `${n} not merged`,
  unchecked: (n) => `${n} git did not list`,
}

const KEEP_ORDER: KeepReason[] = ['changes', 'agent', 'program', 'setup', 'unpushed', 'unmerged', 'unchecked']

/** Why the rest stay, each worktree counted once under its first reason: "3 with changes · 20
 *  not merged". Empty when nothing was kept. */
export function keptSummary(kept: readonly Pick<Candidate, 'keep'>[]): string {
  const counts = new Map<KeepReason, number>()
  for (const c of kept) {
    const first = KEEP_ORDER.find((r) => c.keep.includes(r))
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  return KEEP_ORDER.flatMap((r) => (counts.has(r) ? [KEPT_LABEL[r](counts.get(r)!)] : [])).join(' · ')
}

const KEEP_WHY: Record<KeepReason, (c: Pick<Candidate, 'programs'>) => string> = {
  changes: () => 'it has uncommitted changes',
  agent: () => 'an agent is at work in it',
  program: (c) => `${c.programs.join(', ')} ${c.programs.length === 1 ? 'runs' : 'run'} in it`,
  setup: () => 'its setup is still running',
  unpushed: () => 'it has commits no remote has',
  unmerged: () => 'it is not merged',
  unchecked: () => 'git does not list it',
}

/** Why one worktree stays, every reason: "Kept: it has uncommitted changes; node (4123) runs in it." */
export const keptWhy = (c: Pick<Candidate, 'keep' | 'programs'>): string => `Kept: ${c.keep.map((r) => KEEP_WHY[r](c)).join('; ')}.`

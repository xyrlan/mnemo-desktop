// adapted from stablyai/orca components/sidebar/worktree-review-helpers.tsx,
// components/sidebar/WorktreeCardHelpers.tsx and components/github/review-state-presentation.ts
// (MIT, 122b8c25)
import React, { createElement } from 'react'
import { GitMerge, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { PrNode } from '../fleet/types'

export function PullRequestIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.25 2.25 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1.5 1.5 0 011.5 1.5v5.628a2.25 2.25 0 101.5 0V5.5A3 3 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"
      />
    </svg>
  )
}

// Why: the glyph carries the PR's state — tone alone made a draft with failing checks read as a
// closed PR.
function stateIcon(state: PrNode['state']) {
  if (state === 'merged') return GitMerge
  if (state === 'closed') return GitPullRequestClosed
  if (state === 'draft') return GitPullRequestDraft
  return PullRequestIcon
}

// Why: checks only colour a PR that is open; draft, closed and merged keep their state's tone so
// the glyph agrees with its label.
function checkTone(pr: PrNode): string | null {
  if (pr.state !== 'open') return null
  if (pr.checks === 'failing') return 'text-rose-500/85'
  if (pr.checks === 'pending') return 'text-amber-500/85'
  if (pr.checks === 'passing') return 'text-emerald-500/80'
  return null
}

function stateTone(state: PrNode['state']): string {
  if (state === 'merged') return 'text-purple-600/70 dark:text-purple-400/70'
  if (state === 'open') return 'text-emerald-500/80'
  if (state === 'closed') return 'text-muted-foreground/60'
  return 'text-muted-foreground/50'
}

export function ReviewIcon({ pr, className }: { pr: PrNode; className?: string }): React.JSX.Element {
  return createElement(stateIcon(pr.state), { className: cn(className, checkTone(pr) ?? stateTone(pr.state)) })
}

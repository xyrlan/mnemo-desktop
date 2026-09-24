// adapted from stablyai/orca components/dashboard-popout/AgentKanbanCard.tsx
import { memo } from 'react'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, MessageCircleQuestion, Send } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { AgentStateDot, type DotState } from './AgentStateDot'
import { askOf, formatAgo, transitionName, type DashboardCard } from './model'

const REVIEW = {
  open: { icon: GitPullRequest, label: 'Open PR', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  draft: { icon: GitPullRequestDraft, label: 'Draft PR', className: 'border-border bg-muted/60 text-muted-foreground' },
  merged: { icon: GitMerge, label: 'Merged PR', className: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  closed: { icon: GitPullRequestClosed, label: 'Closed PR', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
} as const

function ReviewPill({ pr }: { pr: DashboardCard['pr'] }) {
  if (!pr) return null
  const p = REVIEW[pr.state]
  const Icon = p.icon
  return (
    <span
      role="img"
      aria-label={`${p.label} #${pr.number}`}
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1 py-px text-[10px] leading-none tabular-nums', p.className)}
    >
      <Icon className="size-2.5" aria-hidden />#{pr.number}
    </span>
  )
}

/** A finished agent is green until the user has looked at its worktree, then settles grey. */
export const displayState = (card: Pick<DashboardCard, 'bucket' | 'unseen'>): DotState =>
  card.bucket === 'done' && !card.unseen ? 'idle' : card.bucket

type Props = {
  card: DashboardCard
  now: number
  onReveal: (card: DashboardCard) => void
}

/** One agent on the board. A click goes to it: its worktree, its pane focused. */
export const AgentKanbanCard = memo(
  function AgentKanbanCard({ card, now, onReveal }: Props) {
    // The two outcomes worth scanning for get a tinted card: orange for "answer me", green for
    // "finished, look at it". Everything else stays neutral, so the tint keeps meaning something.
    const needsYou = card.bucket === 'needs-you'
    const state = displayState(card)
    const isDone = state === 'done'
    const ask = askOf(card)

    return (
      <div
        // A stable per-agent name lets the browser morph the card from its old column to its new one.
        style={{ viewTransitionName: transitionName(card.sessionId) }}
        data-agent-card={card.sessionId}
        className={cn(
          'group flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors',
          needsYou
            ? 'border-agent-question/40 bg-agent-question/[0.06] hover:border-agent-question/60 hover:bg-agent-question/10'
            : isDone
              ? 'border-state-done/40 bg-state-done/[0.06] hover:border-state-done/60 hover:bg-state-done/10'
              : 'border-border/60 bg-card hover:border-border hover:bg-accent/40',
        )}
      >
        <button
          type="button"
          onClick={() => onReveal(card)}
          className="flex w-full flex-col gap-1.5 text-left focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="flex w-full items-center gap-1.5">
            <span className={cn('truncate text-[12.5px]', card.unseen ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground')}>
              {card.title}
            </span>
            {ask ? null : <AgentStateDot state={state} className="ml-auto" />}
          </div>

          {card.branch && card.branch !== card.worktreeName ? (
            <div className="line-clamp-1 w-full font-mono text-[11px] leading-snug text-foreground/70">{card.branch}</div>
          ) : null}

          {ask ? (
            <div className="flex w-full items-start gap-1 rounded-md bg-agent-question/15 px-1.5 py-1 text-[11px] text-agent-question-text ring-1 ring-agent-question/25 ring-inset">
              <MessageCircleQuestion className="mt-px size-3 shrink-0 text-agent-question" aria-hidden="true" />
              <span className="line-clamp-2">{ask}</span>
            </div>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => onReveal(card)}
          tabIndex={-1}
          className="flex w-full items-center gap-2 rounded-md text-left text-[11px] text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-muted-foreground/10 text-[10px] font-semibold text-muted-foreground uppercase transition-colors group-hover:text-foreground"
                aria-label={card.repoName}
              >
                {card.repoName.slice(0, 1)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {card.repoName}
            </TooltipContent>
          </Tooltip>
          {card.kind === 'dispatched' ? (
            <span
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-muted-foreground/10 transition-colors group-hover:text-foreground"
              role="img"
              aria-label="Dispatched"
              title="Dispatched by mnemo"
            >
              <Send className="size-3" aria-hidden />
            </span>
          ) : null}
          <span className="truncate">{card.worktreeName}</span>
          <ReviewPill pr={card.pr} />
          {card.since > 0 ? <span className="ml-auto shrink-0 pl-1 tabular-nums">{formatAgo(card.since, now)}</span> : null}
        </button>
      </div>
    )
  },
  // Cards re-render when what they show changes, and when a minute tick changes their time.
  (a, b) =>
    a.onReveal === b.onReveal &&
    JSON.stringify(a.card) === JSON.stringify(b.card) &&
    (a.card.since <= 0 || formatAgo(a.card.since, a.now) === formatAgo(b.card.since, b.now)),
)

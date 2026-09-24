// adapted from stablyai/orca components/sidebar/worktree-card-surface.tsx,
// components/sidebar/worktree-card-parent-content.tsx, components/sidebar/worktree-card-header.tsx
// [1-105, 158-321], components/sidebar/worktree-card-meta-row.tsx,
// components/sidebar/WorktreeCardMetadataControls.tsx [1-17],
// components/sidebar/WorktreeCardStatusSlot.tsx and
// components/sidebar/WorktreeTitleInlineRename.tsx [336-385] (MIT, 122b8c25)
import React from 'react'
import { LoaderCircle } from 'lucide-react'
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { PrNode, WorktreeNode } from '../fleet/types'
import { StatusIndicator } from './agent-glyphs'
import { activateWorktree } from './actions'
import { useArchive } from './archive'
import { prLabel, STATUS_LABEL, worktreeStatus, type WorktreeStatus } from './model'
import { ReviewIcon } from './review-icon'
import { TruncatedSidebarLabel } from './truncated-label'
import { WorktreeCardAgents } from './WorktreeCardAgents'

/** Orca's flush card inside a repo group (`worktree-list/rows/indentation.ts`): content indent
 *  18 × 1 + 2 = 20, less the 4px pullback. */
const CARD_PADDING_LEFT = 16

// Why a left-edge badge: it overlays unread on the status glyph without widening the lane or
// indenting the title; the ring cuts the dot out of a busy glyph.
const UNREAD_DOT =
  'pointer-events-none absolute -left-0.5 top-1/2 size-[6px] -translate-y-1/2 rounded-full bg-amber-500 ring-2 ring-worktree-sidebar'

/** The status lane: the worktree's status glyph, and the unread dot over it — except while an
 *  agent works or waits on you, which already own the lane. */
function WorktreeCardStatusSlot({ status, unread }: { status: WorktreeStatus; unread: boolean }): React.JSX.Element {
  const showUnread = unread && status !== 'working' && status !== 'permission'
  return (
    <span className="relative inline-flex h-5 w-4 shrink-0 items-center justify-center" data-worktree-status-lane="">
      <StatusIndicator status={status} tooltipSide="right" />
      {showUnread && <span data-worktree-unread-alert="" className={UNREAD_DOT} aria-hidden="true" />}
      <span className="sr-only">{unread ? `${STATUS_LABEL[status]} · Unread` : STATUS_LABEL[status]}</span>
    </span>
  )
}

const BADGE = 'h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 leading-none'

function KindBadge({ kind }: { kind: WorktreeNode['kind'] }): React.JSX.Element | null {
  if (kind === 'workspace') return null
  const [text, tip, tone] =
    kind === 'main'
      ? ['primary', 'Primary worktree (original clone directory)', 'text-foreground/70 border-foreground/20 bg-foreground/[0.06]']
      : // mnemo's own mark, in mnemo's accent: a `mnemo dispatch` child, headless and contract-driven.
        ['dispatched', 'Dispatched by mnemo dispatch: a headless child working to a contract', 'text-brand border-brand/30 bg-brand/10']
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn(BADGE, tone)} data-worktree-kind={kind}>
          {text}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

/** Orca's `MetaIconBadge` for a linked PR, with its number beside the glyph. */
function PrBadge({ pr }: { pr: PrNode }): React.JSX.Element {
  const label = prLabel(pr)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-pr-badge={pr.state}
          className="inline-flex shrink-0 items-center gap-0.5 text-[10px] leading-none tabular-nums text-muted-foreground/70 hover:text-foreground"
        >
          <ReviewIcon pr={pr} className="size-3.5" />
          <span aria-hidden="true">#{pr.number}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** One worktree: status lane, name, branch, PR and its agents. A click shows it and marks it read.
 *  While it is being removed it is greyed out under "Removing…" and takes no clicks. */
export const WorktreeCard = React.memo(function WorktreeCard({
  worktree,
  active,
}: {
  worktree: WorktreeNode
  active: boolean
}): React.JSX.Element {
  const status = worktreeStatus(worktree.agents)
  const hasMetaRow = worktree.branch !== null || worktree.pr !== null
  const showAgents = worktree.agents.length > 0
  const titleOnlyCard = !hasMetaRow && !showAgents
  const removing = useArchive((s) => s.removing.has(worktree.path))
  return (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col pr-1.5 transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none',
        titleOnlyCard ? 'py-2' : 'pt-1.25 pb-1.5',
        'ml-1 w-[calc(100%-0.25rem)] rounded-lg',
        'group-focus-visible/row:ring-1 group-focus-visible/row:ring-worktree-sidebar-ring',
        active ? 'border border-transparent' : 'border border-transparent worktree-sidebar-card-hover',
        removing && 'cursor-not-allowed opacity-50 grayscale',
      )}
      style={{ paddingLeft: CARD_PADDING_LEFT }}
      data-worktree-card-surface="true"
      data-worktree-card-active={active ? 'primary' : undefined}
      aria-busy={removing}
      onClick={() => !removing && activateWorktree(worktree.path)}
    >
      {removing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/50 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background px-3 py-1 text-[11px] font-medium text-foreground shadow-sm">
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            Removing…
          </div>
        </div>
      )}
      <div
        className={cn('flex w-full min-w-0 gap-0.5 pl-0', titleOnlyCard ? 'items-center' : 'items-start')}
        data-worktree-card-parent-content=""
      >
        <div className="flex shrink-0 items-start justify-center" data-worktree-card-status-slot="">
          <WorktreeCardStatusSlot status={status} unread={worktree.unread} />
        </div>

        <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', showAgents ? 'overflow-visible' : 'overflow-hidden')}>
          <div className="group/worktree-card flex w-full min-w-0 flex-col gap-1.5" data-worktree-card-hover-trigger="">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {/* Why: unread lives in the lane; the title adds weight, not colour. */}
                <TruncatedSidebarLabel
                  text={worktree.name}
                  className={cn('text-[13px] leading-5', worktree.unread ? 'font-semibold text-foreground' : 'font-normal text-foreground')}
                >
                  {worktree.unread && <span className="sr-only">Unread: </span>}
                  <span data-worktree-title="">{worktree.name}</span>
                </TruncatedSidebarLabel>
                <KindBadge kind={worktree.kind} />
              </div>
            </div>

            {hasMetaRow && (
              <div className="flex min-w-0 items-center gap-1.5" data-worktree-card-meta-row="">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {worktree.branch !== null && (
                    <TruncatedSidebarLabel text={worktree.branch} className="text-[11px] leading-none text-muted-foreground" />
                  )}
                </div>
                {worktree.pr && (
                  <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">
                    <PrBadge pr={worktree.pr} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Why: counterbalance the stack gap (-mt-1) so agents right after the title read as one group. */}
          {showAgents && <WorktreeCardAgents worktree={worktree} className={hasMetaRow ? 'mt-0' : '-mt-1'} />}
        </div>
      </div>
    </div>
  )
})

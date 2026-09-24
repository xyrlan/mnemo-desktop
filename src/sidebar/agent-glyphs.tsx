// adapted from stablyai/orca components/AgentStateDot.tsx, components/AgentWorkingSpinner.tsx,
// components/AgentQuestionIcon.tsx, components/StateIndicatorTooltip.tsx and
// components/sidebar/StatusIndicator.tsx (MIT, 122b8c25)
import React from 'react'
import { CircleCheck, MessageCircleQuestion } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { DOT_LABEL, STATUS_LABEL, type AgentDotState, type WorktreeStatus } from './model'

// Orca's glyphs keep their shapes; their colours are the foundation's four state tokens, so a
// state reads the same in the sidebar, the dashboard and the tabs.

const SPINNER_ANIMATION_NAME = 'agent-spinner-rotate'

// Why: anchoring the Web Animation timeline gives late mounts exact phase sync without recurring
// JS, so every working spinner on screen turns together.
function handleSpinnerAnimationStart(event: React.AnimationEvent<HTMLSpanElement>): void {
  if (event.animationName !== SPINNER_ANIMATION_NAME) return
  const el = event.currentTarget
  if (typeof el.getAnimations !== 'function') return
  const animation = el.getAnimations().find((a) => 'animationName' in a && a.animationName === SPINNER_ANIMATION_NAME)
  if (animation !== undefined) animation.startTime = 0
}

/** The working ring. Rotates in CSS (`.agent-working-spinner`, sidebar.css) on the compositor;
 *  under reduced motion it stops as a full ring rather than a broken one. */
export function AgentWorkingSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      onAnimationStart={handleSpinnerAnimationStart}
      data-agent-spinner=""
      className={cn(
        'agent-working-spinner block rounded-full border-2 border-state-working border-t-transparent motion-reduce:border-t-state-working',
        className,
      )}
    />
  )
}

/** "The agent is asking you something": one icon and one token everywhere. */
export function AgentQuestionIcon({ className }: { className?: string }): React.JSX.Element {
  return <MessageCircleQuestion className={cn('text-agent-question', className)} aria-hidden="true" />
}

/** A 200 ms tooltip on a state glyph; `null` leaves the glyph bare. */
function StateIndicatorTooltip({
  label,
  side = 'top',
  children,
}: {
  label: string | null
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactElement
}): React.JSX.Element {
  if (label === null) return children
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** One agent's state beside its name: a spinner while working, a check when done, the question
 *  icon when it waits on you, a quiet dot when idle. */
export const AgentStateDot = React.memo(function AgentStateDot({
  state,
  className,
  tooltipSide,
}: {
  state: AgentDotState
  className?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}): React.JSX.Element {
  const box = cn('inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center', className)
  const label = DOT_LABEL[state]
  let indicator: React.JSX.Element
  if (state === 'working') {
    indicator = (
      <span className={box} aria-label={label} data-agent-dot={state}>
        <AgentWorkingSpinner className="size-1.5" />
      </span>
    )
  } else if (state === 'done') {
    indicator = (
      <span className={box} aria-label={label} data-agent-dot={state}>
        <CircleCheck className="size-2.5 text-state-done" aria-hidden="true" />
      </span>
    )
  } else if (state === 'permission' || state === 'waiting') {
    indicator = (
      <span className={box} aria-label={label} data-agent-dot={state}>
        <AgentQuestionIcon className="size-2.5" />
      </span>
    )
  } else {
    indicator = (
      <span className={box} aria-label={label} data-agent-dot={state}>
        <span className="block size-1.5 rounded-full bg-state-idle/40" />
      </span>
    )
  }
  return (
    <StateIndicatorTooltip label={label} side={tooltipSide}>
      {indicator}
    </StateIndicatorTooltip>
  )
})

/** A worktree's status in its card's lane. Idle carries no tooltip: there is nothing to say. */
export const StatusIndicator = React.memo(function StatusIndicator({
  status,
  className,
  tooltipSide,
}: {
  status: WorktreeStatus
  className?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}): React.JSX.Element {
  const box = cn('inline-flex h-3 w-3 shrink-0 items-center justify-center', className)
  let indicator: React.JSX.Element
  if (status === 'working') {
    indicator = (
      <span className={box} aria-hidden="true" data-status={status}>
        <AgentWorkingSpinner className="size-2" />
      </span>
    )
  } else if (status === 'permission') {
    indicator = (
      <span className={box} aria-hidden="true" data-status={status}>
        <AgentQuestionIcon className="size-3" />
      </span>
    )
  } else {
    indicator = (
      <span className={box} aria-hidden="true" data-status={status}>
        <span className={cn('block size-2 rounded-full', status === 'done' ? 'bg-state-done' : 'bg-state-idle/40')} />
      </span>
    )
  }
  return (
    <StateIndicatorTooltip label={status === 'inactive' ? null : STATUS_LABEL[status]} side={tooltipSide}>
      {indicator}
    </StateIndicatorTooltip>
  )
})

// adapted from stablyai/orca components/AgentStateDot.tsx, components/AgentWorkingSpinner.tsx and components/AgentQuestionIcon.tsx
import React from 'react'
import { CircleCheck, MessageCircleQuestion } from 'lucide-react'
import { cn } from '@/ui/cn'

/** The fleet's four states. A finished agent the user has looked at shows `idle` while its card
 *  stays in Done (Orca's rule: green until acknowledged). */
export type DotState = 'working' | 'needs-you' | 'done' | 'idle'

const LABEL: Record<DotState, string> = { working: 'Working', 'needs-you': 'Needs you', done: 'Done', idle: 'Idle' }

const SPINNER_ANIMATION = 'agent-dashboard-spinner-rotate'

// Late mounts join the spinners already turning: every spinner's timeline starts at 0, so all of
// them sit at the same angle. Done on animationstart, not at mount, so no mount forces a style
// recalc for a phase one frame fixes anyway.
function syncSpinnerPhase(e: React.AnimationEvent<HTMLSpanElement>): void {
  if (e.animationName !== SPINNER_ANIMATION || typeof e.currentTarget.getAnimations !== 'function') return
  const a = e.currentTarget.getAnimations().find((x) => 'animationName' in x && x.animationName === SPINNER_ANIMATION)
  if (a) a.startTime = 0
}

/** The spinner turns in CSS (`.agent-dashboard-spinner`, dashboard.css) on the compositor. Under
 *  reduced motion it stops as a full ring: a frozen ring with a gap reads as broken. */
function WorkingSpinner({ className }: { className?: string }) {
  return (
    <span
      onAnimationStart={syncSpinnerPhase}
      data-agent-spinner=""
      className={cn(
        'agent-dashboard-spinner block rounded-full border-2 border-state-working border-t-transparent motion-reduce:border-t-state-working',
        className,
      )}
    />
  )
}

/** One agent's state as a glyph: a spinner working, a question asking, a check done, a grey dot
 *  idle. Next to the card's heading, it says *what state*; the heading says *who*. */
export const AgentStateDot = React.memo(function AgentStateDot({ state, className }: { state: DotState; className?: string }) {
  const box = cn('inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center', className)
  const glyph =
    state === 'working' ? (
      <WorkingSpinner className="size-1.5" />
    ) : state === 'needs-you' ? (
      <MessageCircleQuestion className="size-2.5 text-agent-question" aria-hidden="true" />
    ) : state === 'done' ? (
      <CircleCheck className="size-2.5 text-state-done" aria-hidden="true" />
    ) : (
      <span className="block size-1.5 rounded-full bg-state-idle/60" />
    )
  return (
    <span className={box} role="img" aria-label={LABEL[state]} title={LABEL[state]} data-state-dot={state}>
      {glyph}
    </span>
  )
})

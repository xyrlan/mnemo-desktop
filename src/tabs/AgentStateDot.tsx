// adapted from stablyai/orca src/renderer/src/components/AgentStateDot.tsx
import { CircleCheck, MessageCircleQuestionMark } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { AgentState } from '../fleet/types'

export function agentStateLabel(state: AgentState): string {
  switch (state) {
    case 'working':
      return 'Working'
    case 'needs-you':
      return 'Needs you'
    case 'done':
      return 'Done'
    case 'idle':
      return 'Idle'
  }
}

/** The compact state glyph a tab leads with: a spinner while working, a question while waiting on
 *  you, a check when done, a grey dot when idle — each in its state's colour. */
export function AgentStateDot({ state, size = 'md', className }: { state: AgentState; size?: 'sm' | 'md'; className?: string }) {
  const box = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const inner = size === 'md' ? 'size-2' : 'size-1.5'
  const icon = size === 'md' ? 'size-3' : 'size-2.5'
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, className)} role="img" aria-label={agentStateLabel(state)} data-agent-state={state}>
      {state === 'working' ? (
        // The ring turns on the compositor (tabs.css); under reduced motion it stands still, closed.
        <span className={cn('tab-agent-spinner block rounded-full border-2 border-state-working border-t-transparent motion-reduce:border-t-state-working', inner)} />
      ) : state === 'needs-you' ? (
        <MessageCircleQuestionMark className={cn('text-agent-question', icon)} aria-hidden />
      ) : state === 'done' ? (
        <CircleCheck className={cn('text-state-done', icon)} aria-hidden />
      ) : (
        <span className={cn('block rounded-full bg-state-idle/40', inner)} />
      )}
    </span>
  )
}

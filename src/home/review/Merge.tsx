// adapted from stablyai/orca src/renderer/src/components/pull-request-page/actions/panel.tsx
// (the PR actions card and its merge button; MIT, 122b8c25)
import { Check, GitMerge, GitPullRequest, LoaderCircle, ScrollText, X } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { mergeKey, mergePr, openJobLog, useArm } from '../../cockpit/actions'
import { useCockpit } from '../../cockpit/app-store'
import { jobState, type Job } from '../../cockpit/store'
import type { Pr } from '../types'
import type { ReviewState } from './client'
import { mergeTarget } from './types'

/** Why a merge job failed, in gh's words: the last thing it said on stderr, else the reason it
 *  never ran. */
export function failure(j: Job): string {
  const err = [...j.lines].reverse().find((l) => l.stream === 'err' && l.line.trim())
  return j.error ?? err?.line.trim() ?? (j.code !== null ? `exit ${j.code}` : 'ended by a signal')
}

/** Orca's outlined state pill (`prStateColor`), for the two states a PR the lens lists has. */
export function StatePill({ state }: { state: Pr['state'] }) {
  return (
    <span
      className={cn(
        'hm-pr-state inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        state === 'draft' ? 'border-border bg-muted text-muted-foreground' : 'border-status-success-border bg-status-success-background text-status-success',
      )}
    >
      {state === 'draft' ? 'Draft' : 'Open'}
    </span>
  )
}

const STATE = {
  running: { icon: LoaderCircle, text: 'merging…', tone: 'text-muted-foreground', spin: true },
  ok: { icon: Check, text: 'merged ✓', tone: 'text-status-success', spin: false },
  failed: { icon: X, text: 'merge failed ✗', tone: 'text-destructive', spin: false },
} as const

/** The PR view's merge: the cockpit's own (`mergePr`), asked twice like everywhere else, with
 *  how it went read from the job it ran. Whatever gates a merge is `mergePr`'s; this only
 *  reports what the job says, and a job that failed says gh's reason. */
export default function Merge({ root, pr, review }: { root: string; pr: Pr; review: ReviewState }) {
  const { armed, fire } = useArm()
  const target = review.status === 'ready' ? mergeTarget(pr, review.review) : null
  // The job's key is the cockpit row's, so a merge started there shows here and the other way.
  const key = mergeKey(root, target ?? mergeTarget(pr, { head: '', state: '' }))
  const job = useCockpit((s) => s.jobs[key])
  const state = job ? jobState(job) : null
  const armKey = `merge:${key}`
  const shown = state ? STATE[state] : null
  return (
    <section className="hm-pr-merge rounded-lg border border-border/50 bg-card p-3 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest className="size-3.5 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">Pull request</span>
        </div>
        <StatePill state={pr.state} />
      </div>
      <Button
        type="button"
        size="sm"
        className={cn(
          'w-full justify-center gap-2',
          armed === armKey ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-green-600 text-white hover:bg-green-700',
        )}
        disabled={!target || state === 'running' || state === 'ok'}
        title={target ? 'asks twice' : review.status === 'loading' ? 'reading the PR…' : 'the PR could not be read'}
        onClick={() => target && fire(armKey) && mergePr(root, target)}
      >
        {state === 'running' ? <LoaderCircle className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
        {armed === armKey ? 'really merge?' : 'Merge'}
      </Button>
      {shown && job && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <shown.icon className={cn('size-3 shrink-0', shown.tone, shown.spin && 'animate-spin')} />
          <span className={cn('hm-pr-merge-state', shown.tone)}>{shown.text}</span>
          <Button type="button" variant="ghost" size="xs" className="ml-auto h-5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => openJobLog(key, job.title)}>
            <ScrollText />
            log
          </Button>
        </div>
      )}
      {job && state === 'failed' && <div className="hm-pr-merge-why mt-1.5 text-[11px] break-words text-destructive">{failure(job)}</div>}
    </section>
  )
}

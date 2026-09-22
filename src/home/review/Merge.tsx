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
  return (
    <section className="hm-pr-merge">
      <div className="hm-pr-merge-row">
        <button
          className={`hm-btn${armed === armKey ? ' hm-armed' : ' hm-primary'}`}
          disabled={!target || state === 'running' || state === 'ok'}
          title={target ? 'asks twice' : review.status === 'loading' ? 'reading the PR…' : 'the PR could not be read'}
          onClick={() => target && fire(armKey) && mergePr(root, target)}
        >
          {armed === armKey ? 'really merge?' : 'Merge'}
        </button>
        {state && (
          <span className={`hm-pr-merge-state hm-pr-merge-${state}`}>{state === 'running' ? 'merging…' : state === 'ok' ? 'merged ✓' : 'merge failed ✗'}</span>
        )}
        {job && (
          <button className="hm-link" onClick={() => openJobLog(key, job.title)}>
            log
          </button>
        )}
      </div>
      {job && state === 'failed' && <div className="hm-pr-merge-why">{failure(job)}</div>}
    </section>
  )
}

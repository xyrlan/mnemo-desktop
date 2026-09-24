import { useEffect, useRef } from 'react'
import { useCockpit } from './app-store'
import { jobState } from './store'
import './job-log.css'

/** What a job printed, as it arrives. Each line carries its stream: stdout and stderr are read
 *  apart, so the order between an `out` and an `err` line is only the order they came in, and
 *  the gutter says which is which rather than pretending to one transcript. Follows the tail
 *  while the job runs. */
export function JobLog({ id }: { id: string }) {
  // The job itself, one reference: a selector that built a list here would re-render forever.
  const job = useCockpit((s) => s.jobs[id])
  const end = useRef<HTMLDivElement>(null)
  const count = job?.lines.length ?? 0
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [count])
  if (!job) return <div className="ck-empty">this log is gone (the app restarted since it ran)</div>
  const state = jobState(job)
  return (
    <div className="ck-log">
      {job.lines.map((l, i) => (
        <div key={i} className={`ck-log-line ck-log-${l.stream}`}>
          <span className="ck-log-stream">{l.stream}</span>
          <span className="ck-log-text">{l.line}</span>
        </div>
      ))}
      {job.error && <div className="ck-log-line ck-log-err ck-log-error">{job.error}</div>}
      <div ref={end} className={`ck-log-end ck-log-${state}`}>
        {state === 'running' ? 'running…' : job.code !== null ? `exit ${job.code}` : job.error ? 'did not run' : 'ended by a signal'}
      </div>
    </div>
  )
}

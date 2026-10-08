import { cn } from '@/ui/cn'
import { limitName, percentNow, resetsWhen, tone, type Tone } from './format'
import type { PlanLimit } from './types'

const BAR: Record<Tone, string> = {
  ok: 'bg-status-success',
  warn: 'bg-status-warning',
  bad: 'bg-destructive',
  unknown: 'bg-muted-foreground',
}

/** A bar `percent` long, coloured by `severity`. */
export function LimitBar({ percent, severity, className, label }: { percent: number; severity: string; className?: string; label: string }) {
  return (
    <div
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-severity={severity}
    >
      <div className={cn('h-full rounded-full', BAR[tone(severity)])} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** One limit of a plan: its name, a bar, the percent and when it resets. */
export function LimitRow({ limit, now }: { limit: PlanLimit; now: number }) {
  const name = limitName(limit)
  const percent = percentNow(limit, now)
  const resets = resetsWhen(limit.resetsAt, now)
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1" data-limit={limit.kind}>
      <span className="min-w-0 truncate text-[11px] text-foreground/90" title={`${limit.kind} · ${limit.severity}`}>
        {name}
      </span>
      <span className="text-right text-[11px] tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">{percent}%</span>
        {resets && <span className="ml-1.5">{resets === 'reset' ? 'reset' : `resets ${resets}`}</span>}
      </span>
      <LimitBar className="col-span-2" percent={percent} severity={limit.severity} label={`${name}: ${percent}%`} />
    </li>
  )
}

import { AlertTriangle } from 'lucide-react'
import { cn } from '@/ui/cn'
import { explainErrors, type ErrorSource } from './errors'

/** A snapshot's errors from `sources`, where its data would be: without them a failed read looks
 *  like nothing to show (#367). Nothing when there are none. */
export function SnapshotErrors({ errors, sources, className }: { errors: readonly string[]; sources: readonly ErrorSource[]; className?: string }) {
  const shown = explainErrors(errors, sources)
  if (!shown.length) return null
  return (
    <div role="alert" data-snapshot-errors="" className={cn('flex flex-col gap-1 rounded-md bg-status-warning-background px-2 py-1.5 text-[11px] leading-snug text-foreground/90', className)}>
      {shown.map((e) => (
        <p key={e.text} className="flex min-w-0 items-start gap-1.5 break-words" title={e.detail}>
          <AlertTriangle className="mt-px size-3 shrink-0 text-status-warning" strokeWidth={2.25} aria-hidden />
          <span className="min-w-0">{e.text}</span>
        </p>
      ))}
    </div>
  )
}

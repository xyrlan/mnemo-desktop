import { CircleX } from 'lucide-react'
import { cn } from '@/ui/cn'
import { Dismiss } from './ui'

/** What `mnemo` printed, in monospace, wrapped. */
export const MONO_TEXT = 'm-0 min-w-0 flex-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'
/** The red of a failed read or run. */
export const ERROR_TEXT = `vt-error ${MONO_TEXT} text-destructive`

/** An error the reader can put away: `onDismiss` adds the ×, without it the error stays. */
export function ErrorLine({ text, onDismiss, className }: { text: string; onDismiss?: () => void; className?: string }) {
  return (
    <div className={cn('vt-error-line flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5', className)}>
      <CircleX aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <pre className={ERROR_TEXT}>{text}</pre>
      {onDismiss && <Dismiss onClick={onDismiss} className="-my-1 size-5" />}
    </div>
  )
}

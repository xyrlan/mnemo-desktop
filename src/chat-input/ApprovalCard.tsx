// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatApprovalCard.tsx
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, ShieldQuestion, TriangleAlert } from 'lucide-react'
import { Button } from '@/ui'

export type ApprovalCardProps = {
  /** The tool Claude asks to run: `Bash`, `Edit`, `WebFetch`… */
  tool: string
  /** What it would do, in a line: the command, the file. */
  summary: string
  /** The rest, shown as it is: a diff, a script, a URL's purpose. */
  detail?: string
  onAllow(): Promise<void>
  onDeny(): Promise<void>
}

type Phase = { at: 'open' } | { at: 'sending' | 'sent'; allow: boolean } | { at: 'failed'; message: string }

/** Claude waiting on a permission, answered in one click. Once an answer is on its way the card
 *  keeps saying which until its owner takes it down; a refused answer is shown, and both buttons
 *  work again. */
export function ApprovalCard({ tool, summary, detail, onAllow, onDeny }: ApprovalCardProps) {
  const [phase, setPhase] = useState<Phase>({ at: 'open' })
  const alive = useRef(true)
  useEffect(() => {
    // Set again on every mount: StrictMode unmounts and remounts it once in dev.
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const answer = async (allow: boolean) => {
    setPhase({ at: 'sending', allow })
    try {
      await (allow ? onAllow() : onDeny())
      if (alive.current) setPhase({ at: 'sent', allow })
    } catch (e) {
      if (alive.current) setPhase({ at: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = phase.at === 'sending' || phase.at === 'sent'
  const title = `Allow ${tool}?`
  return (
    <div data-ui data-chat-approval className="min-h-0 shrink overflow-hidden bg-background">
      <div className="mx-auto flex max-h-full min-h-0 w-full max-w-4xl px-3 pt-2 pb-3">
        <div
          role="group"
          aria-label={title}
          aria-busy={phase.at === 'sending'}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-input bg-card px-4 py-3 shadow-xs"
        >
          <div className="flex shrink-0 items-start gap-2">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">{title}</p>
          </div>
          <div tabIndex={0} className="scrollbar-sleek min-h-0 max-h-72 shrink space-y-2 overflow-auto text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70">
            <p className="whitespace-pre-wrap break-words font-mono text-foreground/90">{summary}</p>
            {detail ? <div className="whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2.5 py-2 font-mono">{detail}</div> : null}
          </div>
          {phase.at === 'failed' ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{phase.message}</span>
            </p>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void answer(true)} className="px-4 font-semibold">
              {phase.at !== 'open' && phase.at !== 'failed' && phase.allow ? <Pending sent={phase.at === 'sent'} /> : null}
              Allow
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)} className="px-4 font-semibold">
              {phase.at !== 'open' && phase.at !== 'failed' && !phase.allow ? <Pending sent={phase.at === 'sent'} /> : null}
              Deny
            </Button>
            {phase.at === 'sent' ? <span className="text-xs text-muted-foreground">{phase.allow ? 'Allowed' : 'Denied'} — waiting on Claude</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Pending({ sent }: { sent: boolean }) {
  return sent ? <Check className="size-3.5" strokeWidth={3} /> : <Loader2 className="size-3.5 animate-spin" />
}

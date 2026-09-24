// adapted from stablyai/orca src/renderer/src/components/dictation/DictationIndicator.tsx (MIT, 122b8c25)
import { Square } from 'lucide-react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { Button, Kbd, KbdGroup, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { Phase, VoiceState } from './controller'
import { Grapes } from './Grapes'

type Props = {
  store: StoreApi<VoiceState>
  /** The toggle's keys, shown in the Stop button's tooltip: `['⌘', 'E']`. */
  shortcut: readonly string[]
  onStop(): void
}

/** The line beside the grapes. */
function label(phase: Exclude<Phase, { kind: 'idle' }>, downloading: boolean): string {
  switch (phase.kind) {
    case 'starting':
      return 'Starting mic…'
    case 'listening':
      return 'Listening'
    case 'transcribing':
      return downloading ? 'Waiting for the model…' : 'Processing…'
    case 'done':
      return phase.landed ? 'Dictated' : 'No text field focused'
    case 'note':
      return phase.text
    case 'error':
      return phase.message
  }
}

/** Orca's dictation indicator, floating above the status bar: the grapes, what dictation is
 *  doing and a Stop button while a take is open. After the take, the transcript lingers under
 *  it for a moment (Orca's partial-transcript row; whisper has only the final text). */
export function Indicator({ store, shortcut, onStop }: Props) {
  const phase = useStore(store, (s) => s.phase)
  const download = useStore(store, (s) => s.download)
  if (phase.kind === 'idle') return null

  const open = phase.kind === 'starting' || phase.kind === 'listening'
  const busy = open || phase.kind === 'transcribing'
  const isError = phase.kind === 'error'
  const text = label(phase, download !== null)
  const transcript = phase.kind === 'done' ? phase.text.trim() : ''
  const wide = transcript !== '' || download !== null
  const stopLabel = 'Stop dictation'

  return (
    <div
      data-ui=""
      data-testid="dictation-indicator"
      data-phase={phase.kind}
      className={cn(
        'fixed bottom-12 left-1/2 z-50 -translate-x-1/2 overflow-hidden',
        'border border-border bg-popover/95 text-sm text-popover-foreground shadow-floating backdrop-blur',
        'transition-[width,border-radius,opacity] duration-200 ease-out motion-reduce:transition-none',
        wide ? 'w-[min(28rem,calc(100vw-2rem))] rounded-xl' : 'max-w-[min(28rem,calc(100vw-2rem))] rounded-full',
        isError && 'border-destructive/40 text-destructive',
      )}
    >
      <div className={cn('flex h-10 items-center gap-2 px-2', !open && 'pr-3')}>
        <Grapes level={0} active={busy} transitioning={phase.kind === 'starting' || phase.kind === 'transcribing'} />
        <span aria-hidden className="min-w-0 truncate font-medium">
          {text}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {text}
        </span>
        {open ? (
          <>
            <span aria-hidden className="ml-0.5 h-4 w-px shrink-0 bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={stopLabel}
                  className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  // Keep focus where the text is going.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onStop}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="flex items-center gap-1.5">
                {stopLabel}
                {shortcut.length > 0 ? (
                  <KbdGroup>
                    {shortcut.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </KbdGroup>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </div>
      {transcript ? <p className="truncate border-t border-border px-3 py-2 text-xs text-muted-foreground">{transcript}</p> : null}
      {download !== null ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Downloading speech model {Math.floor(download * 100)}%
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${download * 100}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

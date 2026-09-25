// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatContextUsageRing.tsx
// and native-chat-context-usage-summary.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { ContextUsage } from './types'

const RING_SIZE = 16
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** Past this the window is nearly spent: the ring turns destructive to say so. */
export const CRITICAL_PERCENTAGE = 90
/** Long enough that a pointer crossing the ring doesn't flash the card. */
const HOVER_OPEN_DELAY_MS = 150
/** Long enough for the pointer to cross the gap between the ring and the card. */
const HOVER_CLOSE_DELAY_MS = 100

/** Claude's context window. The transcript names the model but not a 1M-context run
 *  (`[1m]` lives in the CLI's flag, not in `message.model`), so a response that already holds
 *  more than 200k says it was one. */
export function contextWindow(u: ContextUsage): number {
  return /\[1m\]/i.test(u.model ?? '') || u.tokens > 200_000 ? 1_000_000 : 200_000
}

export function contextPercent(u: ContextUsage): number {
  return Math.min(100, Math.round((u.tokens / contextWindow(u)) * 100))
}

/** `18.6k`, `981.4k`, `1M`: a capital M, since a lowercase one reads as minutes. */
export function formatTokens(tokens: number): string {
  const safe = Math.max(0, tokens)
  const trim = (v: string) => (v.endsWith('.0') ? v.slice(0, -2) : v)
  // Compared after rounding, so 999,960 reads `1M` rather than `1000k`.
  if (Math.round(safe / 100) >= 10_000) return `${trim((safe / 1_000_000).toFixed(1))}M`
  if (safe >= 1_000) return `${trim((safe / 1_000).toFixed(1))}k`
  return String(Math.round(safe))
}

/** Open state where only a mouse hover waits, to open and to close; any explicit change drops
 *  a pending hover. */
function useCardOpen() {
  const [open, setOpenState] = useState(false)
  const cancel = useRef<(() => void) | null>(null)
  const drop = useCallback(() => {
    cancel.current?.()
    cancel.current = null
  }, [])
  useEffect(() => drop, [drop])
  const setOpen = useCallback(
    (next: boolean) => {
      drop()
      setOpenState(next)
    },
    [drop],
  )
  const setOpenAfterHover = useCallback(
    (next: boolean) => {
      drop()
      const timer = setTimeout(() => setOpen(next), next ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS)
      cancel.current = () => clearTimeout(timer)
    },
    [drop, setOpen],
  )
  return { open, setOpen, setOpenAfterHover }
}

/** How full the session's context is, as a ring; hover, click or Enter shows the numbers. */
export function ContextRing({ usage }: { usage: ContextUsage }) {
  const percent = contextPercent(usage)
  const critical = percent >= CRITICAL_PERCENTAGE
  const used = formatTokens(usage.tokens)
  const window = formatTokens(contextWindow(usage))
  const label = `Context ${used} of ${window} tokens, ${percent}% used`
  const { open, setOpen, setOpenAfterHover } = useCardOpen()
  return (
    <div
      className="flex"
      // Touch fires pointerleave before its click, so only a mouse drives hover.
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpenAfterHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpenAfterHover(false)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            data-context-usage={percent}
            className={cn(
              'cv-ring flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              critical && 'text-destructive',
            )}
            // A readout: clicking it must not pull focus out of the composer.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              // Open, never toggle: a hover already opened it, and a click must not close it.
              e.preventDefault()
              setOpen(true)
            }}
          >
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" className="-rotate-90">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={RING_STROKE} className="opacity-25" />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
              />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={label}
          side="bottom"
          align="end"
          sideOffset={8}
          className="w-72"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="p-4">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">Context</span>
              <span className="text-muted-foreground tabular-nums">
                {used}/{window}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
              <div className={cn('h-full rounded-full bg-primary transition-all', critical && 'bg-destructive')} style={{ width: `${percent}%` }} />
            </div>
            {usage.model && <p className="mt-3 text-xs text-muted-foreground">{usage.model}</p>}
            <p className="mt-3 text-[11px] text-muted-foreground">Estimated from the last response.</p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

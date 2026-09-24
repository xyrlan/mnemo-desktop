// adapted from stablyai/orca components/dashboard-popout/AgentKanbanBoard.tsx
import { useEffect, useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { TooltipProvider } from '@/ui'
import { cn } from '@/ui/cn'
import { AgentKanbanCard } from './AgentKanbanCard'
import { BUCKET_LABEL, BUCKETS, groupByBucket, type Bucket, type DashboardCard } from './model'

/** How often the cards' "5m" ages are read again. */
const TICK_MS = 30_000

function KanbanColumn({ bucket, cards, now, onReveal }: { bucket: Bucket; cards: DashboardCard[]; now: number; onReveal: (card: DashboardCard) => void }) {
  return (
    // The cards carry their own state colour; a tinted column would say it twice.
    <section data-bucket={bucket} aria-label={BUCKET_LABEL[bucket]} className="flex min-w-[264px] flex-1 flex-col rounded-xl border border-border/60 bg-muted/30">
      <header className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">{BUCKET_LABEL[bucket]}</span>
        <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] text-muted-foreground tabular-nums" data-count>
          {cards.length}
        </span>
      </header>
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">None</p>
        ) : (
          cards.map((card) => <AgentKanbanCard key={card.sessionId} card={card} now={now} onReveal={onReveal} />)
        )}
      </div>
    </section>
  )
}

type Props = {
  cards: DashboardCard[]
  onReveal: (card: DashboardCard) => void
  onClose?: () => void
  className?: string
}

/** The agent board: four columns — Needs you, Working, Done, Idle — of every agent in the fleet,
 *  interactive sessions and dispatched children together. */
export function AgentKanbanBoard({ cards, onReveal, onClose, className }: Props) {
  const grouped = useMemo(() => groupByBucket(cards), [cards])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('relative flex flex-col bg-background text-foreground', className)}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <h1 className="text-[13px] font-semibold">Agents</h1>
          <span className="text-[11px] text-muted-foreground">{cards.length} total</span>
          {onClose ? (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dashboard"
                className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="scrollbar-sleek flex min-h-0 flex-1 overflow-x-auto p-3">
          {/* Auto margins centre the capped board and give way when it overflows. */}
          <div className="mx-auto flex w-full max-w-[1280px] gap-3">
            {BUCKETS.map((bucket) => (
              <KanbanColumn key={bucket} bucket={bucket} cards={grouped[bucket]} now={now} onReveal={onReveal} />
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

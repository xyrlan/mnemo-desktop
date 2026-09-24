// adapted from stablyai/orca components/NotificationCardStack.tsx and components/UpdateCard.tsx
import { CircleCheck, MessageCircleQuestion, ShieldAlert, X } from 'lucide-react'
import { useStore } from 'zustand'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import type { AlertKind } from './decide'
import type { Card, Notifier } from './notifier'

const ICON: Record<AlertKind, typeof CircleCheck> = { done: CircleCheck, permission: ShieldAlert, question: MessageCircleQuestion }
const TONE: Record<AlertKind, string> = { done: 'text-state-done', permission: 'text-state-needs-you', question: 'text-agent-question' }
const LABEL: Record<AlertKind, string> = { done: 'Done', permission: 'Needs permission', question: 'Has a question' }

/** Orca's notification stack: a column at the bottom right, newest at the bottom, above the
 *  status bar. */
export function NotificationStack({ notifier }: { notifier: Pick<Notifier, 'cards' | 'open' | 'dismiss'> }) {
  const cards = useStore(notifier.cards, (s) => s.cards)
  if (!cards.length) return null
  return (
    // `data-ui`: should the shell's overlay slot sit inside the old `.app` scope, the stack still
    // gets the new look (theme.css reverts everything else there).
    <div
      data-ui
      data-notification-stack
      className="pointer-events-none fixed bottom-10 right-4 z-toast flex max-h-[calc(100vh-80px)] w-[360px] max-w-[calc(100vw-32px)] flex-col-reverse gap-2 overflow-y-auto scrollbar-sleek [&>*]:pointer-events-auto [&>*]:shrink-0 max-[480px]:left-4 max-[480px]:right-4 max-[480px]:w-auto"
    >
      {[...cards].reverse().map((c) => (
        <NotificationCard key={c.id} card={c} onOpen={() => notifier.open(c.id)} onDismiss={() => notifier.dismiss(c.id)} />
      ))}
    </div>
  )
}

export function NotificationCard({ card, onOpen, onDismiss }: { card: Card; onOpen(): void; onDismiss(): void }) {
  const Icon = ICON[card.kind]
  const where = card.repo && card.repo !== card.name ? card.repo : null
  return (
    <div
      role="complementary"
      aria-label={`${card.name}: ${LABEL[card.kind]}`}
      aria-live="polite"
      data-kind={card.kind}
      className="group flex rounded-xl border bg-card text-card-foreground shadow-floating motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right motion-safe:duration-200"
    >
      <button
        type="button"
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Escape' && onDismiss()}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', TONE[card.kind])} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium">{card.name}</span>
            {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
          </span>
          <span className={cn('text-[11px] font-medium uppercase tracking-wide', TONE[card.kind])}>{LABEL[card.kind]}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{card.message}</span>
        </span>
      </button>
      <Button variant="ghost" size="icon" className="m-1.5 size-7 shrink-0" onClick={onDismiss} aria-label="Dismiss">
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

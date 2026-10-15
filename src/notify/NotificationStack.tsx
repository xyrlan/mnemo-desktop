// adapted from stablyai/orca components/NotificationCardStack.tsx and components/UpdateCard.tsx
import { CircleCheck, MessageCircleQuestion, ShieldAlert } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import '../nexus/ui/ui.css'
import './notify.css'
import type { AlertKind } from './decide'
import type { Card, Notifier } from './notifier'

const ICON: Record<AlertKind, typeof CircleCheck> = { done: CircleCheck, permission: ShieldAlert, question: MessageCircleQuestion }
const LABEL: Record<AlertKind, string> = { done: 'Done', permission: 'Needs permission', question: 'Has a question' }

/** The notification stack, in the ship's look (`./notify.css`): a column at the top right,
 *  under the ship's bar, newest at the top. A card's click opens its session in the Nexus. Drawn at
 *  the end of `<body>`, as the Nexus's windows and menus are, so its layer is its own (`notify.css`). */
export function NotificationStack({ notifier }: { notifier: Pick<Notifier, 'cards' | 'open' | 'dismiss'> }) {
  const cards = useStore(notifier.cards, (s) => s.cards)
  if (!cards.length) return null
  return createPortal(
    <div data-notification-stack="" className="nx nx-notes">
      {[...cards].reverse().map((c) => (
        <NotificationCard key={c.id} card={c} onOpen={() => notifier.open(c.id)} onDismiss={() => notifier.dismiss(c.id)} />
      ))}
    </div>,
    document.body,
  )
}

export function NotificationCard({ card, onOpen, onDismiss }: { card: Card; onOpen(): void; onDismiss(): void }) {
  const Icon = ICON[card.kind]
  const where = card.repo && card.repo !== card.name ? card.repo : null
  return (
    <div role="complementary" aria-label={`${card.name}: ${LABEL[card.kind]}`} aria-live="polite" data-kind={card.kind} className="nx-note">
      <button type="button" className="nx-note-open" title="Open it in the Nexus" onClick={onOpen} onKeyDown={(e) => e.key === 'Escape' && onDismiss()}>
        <Icon className="nx-note-icon" aria-hidden />
        <span className="nx-note-text">
          <span className="nx-note-head">
            <span className="nx-note-name">{card.name}</span>
            {where && <span className="nx-note-repo">{where}</span>}
          </span>
          <span className="nx-note-kind">{LABEL[card.kind]}</span>
          <span className="nx-note-message">{card.message}</span>
          {card.unopened && (
            <span className="nx-note-unopened" data-unopened="">
              It is not on the ship yet: nothing to open.
            </span>
          )}
        </span>
      </button>
      <button type="button" className="nx-note-close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        ×
      </button>
    </div>
  )
}

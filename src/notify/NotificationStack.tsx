import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { Figure, Kbd, StateMark } from '../ds'
import { sessionOf, useWorld } from '../world/store'
import type { SessionState } from '../world/types'
import type { AlertKind } from './decide'
import type { Card, Notifier } from './notifier'
import { useOverlayRoot } from './overlay'
import './notify.css'

const LABEL: Record<AlertKind, string> = { done: 'Done', permission: 'Needs permission', question: 'Has a question' }

/** What happened, as the state it leaves the session in: an ask is a need; a finished turn is the
 *  maintainer's move. The card wears that state's shape and hue, as a waiting card does. */
const SIGN: Record<AlertKind, SessionState> = { done: 'idle', permission: 'need', question: 'need' }

/** The notification stack, in the new identity (`./notify.css`): a column at the top right,
 *  under the top bar, newest at the top. A card's click opens its session. Drawn at the end of
 *  `<body>`, as the Nexus's windows and menus are, so its layer is its own (`notify.css`). */
export function NotificationStack({ notifier }: { notifier: Pick<Notifier, 'cards' | 'open' | 'dismiss'> }) {
  const cards = useStore(notifier.cards, (s) => s.cards)
  const root = useOverlayRoot('note-stack')
  if (!cards.length) return null
  return createPortal(
    <div data-notification-stack="" {...root}>
      {[...cards].reverse().map((c) => (
        <NotificationCard key={c.id} card={c} onOpen={() => notifier.open(c.id)} onDismiss={() => notifier.dismiss(c.id)} />
      ))}
    </div>,
    document.body,
  )
}

/** One card, read as a waiting card is: the session's figure, its title in full, where it runs,
 *  what happened, and the keys that act on the card while it has the keyboard. */
export function NotificationCard({ card, onOpen, onDismiss }: { card: Card; onOpen(): void; onDismiss(): void }) {
  // The world knows the session's own title; before it has it, the card is named by where the
  // agent runs.
  const title = useWorld((w) => sessionOf(w, card.sessionId)?.title) || card.name
  const where = [card.repo, card.name].filter((part, i, all): part is string => !!part && part !== title && all.indexOf(part) === i).join(' · ')
  return (
    <div role="complementary" aria-label={`${title}: ${LABEL[card.kind]}`} aria-live="polite" data-kind={card.kind} data-state={SIGN[card.kind]} className="note">
      <button type="button" className="note-open" title="Open it on stage" onClick={onOpen} onKeyDown={(e) => e.key === 'Escape' && onDismiss()}>
        <Figure id={card.sessionId} size="2.5em" className="note-figure" />
        <span className="note-text">
          <span className="note-title">{title}</span>
          {where && <span className="note-where">{where}</span>}
          <span className="note-what">
            <span className="note-sign" aria-hidden="true">
              <StateMark state={SIGN[card.kind]} />
            </span>
            <span className="note-kind">{LABEL[card.kind]}</span>
          </span>
          <span className="note-message">{card.message}</span>
          {card.unopened && (
            <span className="note-unopened" data-unopened="">
              It is not in the fleet yet: nothing to open.
            </span>
          )}
          <span className="note-keys" aria-hidden="true">
            <Kbd>Enter</Kbd> open <Kbd>Esc</Kbd> dismiss
          </span>
        </span>
      </button>
      <button type="button" className="note-close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        ×
      </button>
    </div>
  )
}

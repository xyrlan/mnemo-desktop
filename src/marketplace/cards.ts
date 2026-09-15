/** The Import button's life: idle → importing → ok | error, and back to idle when the
 *  output is dismissed. A second Import while one runs is ignored, and a result that
 *  arrives for a card no longer importing (dismissed, say) is dropped. */
export type Card =
  | { status: 'idle' }
  | { status: 'importing'; cwd: string }
  | { status: 'ok' | 'error'; cwd: string; output: string }

export type CardEvent =
  | { type: 'start'; cwd: string }
  | { type: 'done'; ok: boolean; output: string }
  | { type: 'dismiss' }

export const IDLE: Card = { status: 'idle' }

export function cardReducer(card: Card, e: CardEvent): Card {
  switch (e.type) {
    case 'start':
      return card.status === 'importing' ? card : { status: 'importing', cwd: e.cwd }
    case 'done':
      return card.status === 'importing' ? { status: e.ok ? 'ok' : 'error', cwd: card.cwd, output: e.output } : card
    case 'dismiss':
      return card.status === 'importing' ? card : IDLE
  }
}

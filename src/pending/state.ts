// What a waiting item's card is in the middle of: an answer on its way, a refusal, the answer
// that was taken, a reply being typed. It is kept here and not in the card, because the same
// item is drawn in more than one place at once (a roster entry and the foot of the stage's
// transcript, say) and the frame's keys answer it from outside any of them.

import { create } from 'zustand'
import { actions, type Outcome } from '../world/actions'
import { routeStore, type Route } from '../world/route'
import { pendingInOrder, worldStore } from '../world/store'
import type { Pending, World } from '../world/types'

/** The waiting item a digit answers right now: the one whose card is open, else the first
 *  that waits on the selected session. */
export function armedPending(world: World, route: Route): Pending | null {
  return world.pending.find((p) => p.id === route.pending) ?? world.pending.find((p) => p.session === route.session) ?? null
}

/** The item after the armed one, in roster order, wrapping; null when nothing waits. */
export function nextPending(world: World, route: Route): Pending | null {
  const order = pendingInOrder(world)
  if (!order.length) return null
  const armed = armedPending(world, route)
  const at = armed ? order.findIndex((p) => p.id === armed.id) : -1
  return order[(at + 1) % order.length]
}

/** An answer that was taken. `words`: it was typed, not picked. */
export interface Settled {
  said: string
  words: boolean
  /** What the action added (`Outcome.note`), when it says more than the choice did. */
  note: string | null
}

export interface Card {
  /** The item this is about: an id can come back with another question behind it. */
  of: string
  /** The answer on its way: a choice's digit, or the typed reply. */
  sending: number | 'words' | null
  /** What went wrong, said as the action said it. */
  trouble: string | null
  settled: Settled | null
  /** "In your words" is open, and what is typed so far. */
  words: boolean
  draft: string
}

const IDLE: Card = { of: '', sending: null, trouble: null, settled: null, words: false, draft: '' }

interface PendingState {
  cards: Record<string, Card>
  /** The card whose text field takes the focus; `n` changes each time one opens. */
  focus: { id: string; n: number } | null
  /** The last answer taken, for the top bar to say once. */
  last: { said: string; n: number } | null
}

export const pendingStore = create<PendingState>(() => ({ cards: {}, focus: null, last: null }))

/** How long an accepted answer stands for an item the world still lists. A live world drops
 *  the item at its next reading; one that still lists it after this is waiting again. */
export const STILL_WAITS_MS = 30_000

const signature = (p: Pending): string => `${p.since ?? ''}|${p.text}`

/** The card's state for this item: nothing, unless it was kept for this very item. */
export function cardOf(state: PendingState, pending: Pending): Card {
  const kept = state.cards[pending.id]
  return kept && kept.of === signature(pending) ? kept : IDLE
}

/** Change what is kept for an item. The card's own verbs below are how the app does it. */
export function patch(pending: Pending, change: Partial<Card>): void {
  pendingStore.setState((s) => ({ cards: { ...s.cards, [pending.id]: { ...cardOf(s, pending), ...change, of: signature(pending) } } }))
}

/** Nothing more is taken for an item whose answer is on its way or was accepted. */
const closed = (card: Card): boolean => card.sending !== null || card.settled !== null

const waits = (id: string): Pending | undefined => worldStore.getState().world.pending.find((p) => p.id === id)

/** A refusal is an answer; an action that throws anyway is said the same way. */
async function attempt(act: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await act()
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) }
  }
}

function settle(pending: Pending, out: Outcome, settled: Settled): void {
  if (!out.ok) {
    patch(pending, { sending: null, trouble: out.why })
    return
  }
  const note = out.note && out.note !== settled.said ? out.note : null
  patch(pending, { sending: null, settled: { ...settled, note }, words: false, draft: '' })
  pendingStore.setState((s) => ({ last: { said: settled.words ? 'in your words' : settled.said, n: (s.last?.n ?? 0) + 1 } }))
  // One timer per accepted answer, and none at rest: it forgets the card of an item that left
  // the world, and gives back the choices of one that is still listed.
  const of = signature(pending)
  setTimeout(() => {
    const kept = pendingStore.getState().cards[pending.id]
    if (!kept || kept.of !== of || !kept.settled) return
    const still = waits(pending.id)
    if (still && signature(still) === of) {
      patch(still, { settled: null, trouble: `Answered "${kept.settled.said}", and it still waits.` })
      return
    }
    pendingStore.setState((s) => {
      const { [pending.id]: _gone, ...cards } = s.cards
      return { cards }
    })
  }, STILL_WAITS_MS)
}

/** Pick one of an item's choices. Null when there was nothing to do: no such choice, or an
 *  answer already on its way or taken. */
export async function answer(pending: Pending, key: number): Promise<Outcome | null> {
  const choice = pending.choices.find((c) => c.key === key)
  if (!choice || closed(cardOf(pendingStore.getState(), pending))) return null
  patch(pending, { sending: key, trouble: null })
  const out = await attempt(() => actions().answer(pending.id, key))
  settle(pending, out, { said: choice.label, words: false, note: null })
  return out
}

/** Send what is typed in an item's "in your words". Null when nothing is typed, or an answer
 *  is already on its way or taken. */
export async function sendWords(pending: Pending): Promise<Outcome | null> {
  const card = cardOf(pendingStore.getState(), pending)
  const text = card.draft.trim()
  if (!text || closed(card)) return null
  patch(pending, { sending: 'words', trouble: null })
  const out = await attempt(() => actions().reply(pending.session, text))
  settle(pending, out, { said: text, words: true, note: null })
  return out
}

/** The card a click opened the field on: the one drawing of the item that takes the focus. */
let asked: Element | null = null

/** Open "in your words" on an item, starting from mnemo's suggestion when it has one. `from`
 *  is the card that was clicked; without it the first one on screen takes the focus. */
export function openWords(pending: Pending, from: Element | null = null): boolean {
  const card = cardOf(pendingStore.getState(), pending)
  if (!pending.reply || closed(card)) return false
  asked = from
  patch(pending, { words: true, draft: card.draft || pending.suggestedReply || '' })
  pendingStore.setState((s) => ({ focus: { id: pending.id, n: (s.focus?.n ?? 0) + 1 } }))
  return true
}

export function closeWords(pending: Pending): void {
  patch(pending, { words: false })
}

export function typeWords(pending: Pending, draft: string): void {
  patch(pending, { draft })
}

const shown = (el: Element): boolean => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true)

/** Whether `card` is the drawing of item `id` whose field takes the focus now. */
export function takesFocus(id: string, card: Element): boolean {
  if (asked?.isConnected) return asked === card
  const drawn = [...document.querySelectorAll('[data-pending-id]')].filter((el) => el.getAttribute('data-pending-id') === id)
  return (drawn.find(shown) ?? drawn[0]) === card
}

/** For the frame's digits: answer the armed item with choice `key`. Null when nothing is
 *  armed, it has no such choice, or it is already answered. */
export function answerArmed(key: number): Promise<Outcome | null> {
  const armed = armedPending(worldStore.getState().world, routeStore.getState().route)
  return armed ? answer(armed, key) : Promise.resolve(null)
}

/** For the frame's `R`: open "in your words" on the armed item and put the caret in it.
 *  False when nothing armed takes a reply, so the key is not spent. */
export function replyArmed(): boolean {
  const armed = armedPending(worldStore.getState().world, routeStore.getState().route)
  return armed ? openWords(armed) : false
}

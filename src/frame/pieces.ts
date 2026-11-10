// What the frame takes from the pending piece for its keys and its top bar: `WaitingCount`,
// `answerArmed`, `replyArmed`. The seam's placeholder does not export them yet, so each is read
// off the module as it is at run time, with a plain stand-in until the piece lands. Nothing
// here needs editing when it does: the real export wins the moment it exists.

import { createElement, type ReactElement } from 'react'
import { Kbd } from '../ds'
import * as pending from '../pending'
import { actions, type Outcome } from '../world/actions'
import { go, routeStore, useRoute } from '../world/route'
import { useWorld, worldStore } from '../world/store'

interface Theirs {
  WaitingCount?: () => ReactElement
  answerArmed?: (key: number) => Promise<Outcome | null>
  replyArmed?: () => boolean | void
}

const theirs = (): Theirs => pending as unknown as Theirs

const armed = () => pending.armedPending(worldStore.getState().world, routeStore.getState().route)

/** A digit: answers the waiting item whose card is armed. Null when nothing is, or when the
 *  digit is not one of its choices. */
export function answerArmed(key: number): Promise<Outcome | null> {
  const real = theirs().answerArmed
  if (real) return real(key)
  const item = armed()
  if (!item || !item.choices.some((c) => c.key === key)) return Promise.resolve(null)
  return actions().answer(item.id, key)
}

/** `R`: the armed item answered in his own words. False when nothing armed takes a reply, so
 *  the key was not spent. */
export function replyArmed(): boolean {
  const real = theirs().replyArmed
  if (real) return real() !== false
  const item = armed()
  if (!item || !item.reply) return false
  go({ session: item.session, pending: item.id })
  // The card opens with the route; its field is there on the next frame.
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-pending][data-armed] :is(textarea, input[type="text"], input:not([type]))')?.focus())
  return true
}

function WaitingStandIn(): ReactElement {
  const count = useWorld((w) => w.pending.length)
  const world = useWorld((w) => w)
  const route = useRoute((r) => r)
  const next = () => {
    const p = pending.nextPending(world, route)
    if (p) go({ session: p.session, pending: p.id })
  }
  return createElement(
    'button',
    { type: 'button', className: 'frame-waiting', 'data-clear': count ? undefined : true, onClick: next },
    count ? createElement('b', { className: 'mn-num' }, count) : createElement('i', { className: 'frame-waiting-clear', 'aria-hidden': true }),
    createElement('span', null, count ? `${count === 1 ? 'waits' : 'wait'} for you` : 'nothing waits for you'),
    count ? createElement(Kbd, null, 'N') : null,
  )
}

/** How many wait, with the key that walks them. */
export function WaitingCount(): ReactElement {
  return createElement(theirs().WaitingCount ?? WaitingStandIn)
}

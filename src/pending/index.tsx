// What waits, and how it is answered: one card, one keyed list, in every view
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "One way to answer"). A placeholder
// until the piece lands; the two functions below are already the real ones.

import { Kbd } from '../ds'
import { actions } from '../world/actions'
import type { Route } from '../world/route'
import { pendingInOrder } from '../world/store'
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

/** A waiting item with its choices. `armed`: digits answer this one now. */
export function PendingCard({ pending, armed }: { pending: Pending; armed: boolean }) {
  return (
    <div data-pending={pending.kind} data-armed={armed || undefined} style={{ border: '1px solid var(--need)', padding: '0.6em', margin: '0.4em 0' }}>
      <p style={{ margin: 0 }}>{pending.text}</p>
      {pending.choices.map((c) => (
        <button key={c.key} type="button" data-tone={c.tone} onClick={() => void actions().answer(pending.id, c.key)} style={{ marginRight: '0.8em' }}>
          <Kbd>{c.key}</Kbd> {c.label}
        </button>
      ))}
    </div>
  )
}

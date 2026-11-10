// How many wait, in the top bar: the count that is always there, a mark per item in the order
// `N` walks them, and the walk itself on a click.

import { Kbd } from '../ds'
import { HOME, go, routeStore, useRoute } from '../world/route'
import { pendingInOrder, useWorld, worldStore } from '../world/store'
import { Shape, TONE } from './PendingCard'
import { armedPending, nextPending, pendingStore } from './state'
import './pending.css'

/** More marks than this and the rest are a number: the bar has other things to say. */
const MARKS = 9

/** Go to the next thing that waits, as `N` does. */
function walk(): void {
  const next = nextPending(worldStore.getState().world, routeStore.getState().route)
  if (next) go({ pending: next.id, session: next.session })
}

/** The count of what waits, for the top bar. */
export function WaitingCount() {
  const world = useWorld((w) => w)
  const open = useRoute((r) => r.pending)
  const session = useRoute((r) => r.session)
  const last = pendingStore((s) => s.last)
  const order = pendingInOrder(world)
  const armed = armedPending(world, { ...HOME, pending: open, session })
  const n = order.length
  const echo = last && (
    <span key={last.n} className="pending-echo" role="status" onAnimationEnd={() => pendingStore.setState((s) => (s.last === last ? { last: null } : s))}>
      <i aria-hidden="true">✓</i>
      <span>{last.said}</span>
    </span>
  )

  if (!n) {
    return (
      <span className="pending-waiting" data-clear="true">
        <i className="pending-clear-mark" aria-hidden="true" />
        <span>nothing waits for you</span>
        {echo}
      </span>
    )
  }
  const at = armed ? order.findIndex((p) => p.id === armed.id) : -1
  return (
    <button type="button" className="pending-waiting" title="Go to the next thing that waits" aria-keyshortcuts="N" onClick={walk}>
      <b className="mn-num">{n}</b>
      <span>{n === 1 ? 'waits' : 'wait'} for you</span>
      <span className="pending-marks" aria-label={at < 0 ? undefined : `on ${at + 1} of ${n}`}>
        {order.slice(0, MARKS).map((p, i) => (
          <Shape key={p.id} tone={TONE[p.kind]} on={i === at} />
        ))}
        {n > MARKS && <span className="pending-more">{`+${n - MARKS}`}</span>}
      </span>
      <Kbd>N</Kbd>
      {echo}
    </button>
  )
}

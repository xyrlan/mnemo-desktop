// The roster: every session, whole, in the order of attention, children inside their parent
// (docs/superpowers/specs/2026-11-10-recreation-design.md). A placeholder until the piece lands.

import { Figure, StateMark } from '../ds'
import { OrbitMap } from '../orbit'
import { PendingCard, armedPending } from '../pending'
import { openOnStage, useRoute } from '../world/route'
import { childrenOf, pendingOf, roots, useWorld } from '../world/store'

/** Console's left column, and the app's one list of sessions. */
export function Roster() {
  const world = useWorld((w) => w)
  const route = useRoute((r) => r)
  const armed = armedPending(world, route)
  return (
    <nav data-roster style={{ overflow: 'auto', height: '100%', borderRight: '1px solid var(--line)' }}>
      <OrbitMap focus={route.session} />
      {roots(world).map((s) => (
        <div key={s.id} data-state={s.state} data-on-stage={route.session === s.id || undefined} style={{ padding: '0.6em 1em' }}>
          <button type="button" onClick={() => openOnStage(s.id)} style={{ display: 'flex', gap: '0.6em', alignItems: 'center', textAlign: 'left' }}>
            <Figure id={s.id} size={22} /> <StateMark state={s.state} /> {s.title}
          </button>
          {pendingOf(world, s.id).map((p) => (
            <PendingCard key={p.id} pending={p} armed={armed?.id === p.id} />
          ))}
          {childrenOf(world, s).map((c) => (
            <div key={c.id} data-state={c.state} style={{ paddingLeft: '2em' }}>
              <button type="button" onClick={() => openOnStage(c.id)}>
                <StateMark state={c.state} /> {c.title}
              </button>
              {pendingOf(world, c.id).map((p) => (
                <PendingCard key={p.id} pending={p} armed={armed?.id === p.id} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </nav>
  )
}

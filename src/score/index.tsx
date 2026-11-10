// Score: the day, left to right, a line per session, now at the right edge
// (docs/superpowers/specs/2026-11-10-recreation-design.md). A placeholder until the piece lands.

import { StateMark } from '../ds'
import { select, useRoute } from '../world/route'
import { rosterOrder, useWorld } from '../world/store'

/** The whole-window time view. */
export function ScoreView() {
  const world = useWorld((w) => w)
  const selected = useRoute((r) => r.session)
  return (
    <section data-view="score" style={{ position: 'absolute', inset: 0, padding: '2em', overflow: 'auto' }}>
      {rosterOrder(world).map((s) => (
        <div key={s.id} data-state={s.state} data-selected={selected === s.id || undefined} style={{ display: 'grid', gridTemplateColumns: '1fr 24em', alignItems: 'center', gap: '1em', height: '2.4em' }}>
          <i style={{ height: 1, background: 'var(--line-2)' }} />
          <button type="button" onClick={() => select(s.id)} style={{ textAlign: 'left' }}>
            <StateMark state={s.state} /> {s.title}
          </button>
        </div>
      ))}
    </section>
  )
}

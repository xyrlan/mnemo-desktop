// Orbit: the fleet as one scene, where distance is attention and direction is the project
// (docs/superpowers/specs/2026-11-10-recreation-design.md). A placeholder until the piece lands.

import { Figure, Lattice, StateMark } from '../ds'
import { openOnStage, select, useRoute } from '../world/route'
import { roots, useWorld } from '../world/store'

/** The whole-window scene: the view the app opens on. */
export function OrbitView() {
  const world = useWorld((w) => w)
  const selected = useRoute((r) => r.session)
  return (
    <section data-view="orbit" style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
      <div style={{ height: '70%' }}>
        <Lattice />
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.6em' }}>
        {roots(world).map((s) => (
          <li key={s.id} data-state={s.state} data-selected={selected === s.id || undefined}>
            <button type="button" onClick={() => select(s.id)} onDoubleClick={() => openOnStage(s.id)} style={{ display: 'flex', gap: '0.6em', alignItems: 'center' }}>
              <Figure id={s.id} size={22} /> <StateMark state={s.state} word /> {s.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The scene, small: "where it stands", at the head of the roster while a session is on
 *  stage. `focus` is the session whose family is lit. */
export function OrbitMap({ focus }: { focus: string | null }) {
  return (
    <div data-orbit-map data-focus={focus ?? undefined} style={{ height: '9em', opacity: 0.6 }}>
      <Lattice />
    </div>
  )
}

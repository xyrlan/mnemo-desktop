// The stage: the session the maintainer is in, with its terminal
// (docs/superpowers/specs/2026-11-10-recreation-design.md). A placeholder until the piece lands.

import { Figure, Label, StateMark } from '../ds'
import { LiveTerminal, canHost } from '../runtime'
import { useRoute } from '../world/route'
import { sessionOf, useWorld } from '../world/store'

/** Console's middle column: the session `route.session` names. */
export function Stage() {
  const id = useRoute((r) => r.session)
  const session = useWorld((w) => sessionOf(w, id))
  if (!session) return <section data-stage style={{ padding: '2em' }}>No session on stage.</section>
  return (
    <section data-stage data-state={session.state} style={{ padding: '1.4em', height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '1em', minWidth: 0 }}>
      <header style={{ display: 'flex', gap: '1em', alignItems: 'center' }}>
        <Figure id={session.id} size={56} />
        <div>
          <StateMark state={session.state} word /> <Label>{session.project}</Label>
          <h1 style={{ margin: 0, font: '700 2em/1.1 var(--display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{session.title}</h1>
        </div>
      </header>
      {canHost(session) ? <LiveTerminal sessionId={session.id} active /> : <pre className="mn-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', color: 'var(--ink-2)' }}>{session.recap?.text ?? session.said?.text ?? ''}</pre>}
    </section>
  )
}

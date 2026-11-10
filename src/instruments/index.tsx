// The instruments: what is known of a session, always open beside it: context and tokens,
// memory, sight (docs/superpowers/specs/2026-11-10-recreation-design.md). A placeholder until
// the piece lands.

import { Label, Meter } from '../ds'
import { sum, tokens } from '../world/format'
import { useRoute } from '../world/route'
import { sessionOf, useWorld } from '../world/store'

/** The three readings of one session. `at`: as of that moment (Score's playhead); absent or
 *  null is now. */
export function Instruments({ sessionId, at }: { sessionId: string; at?: number | null }) {
  const session = useWorld((w) => sessionOf(w, sessionId))
  const reading = useRoute((r) => r.reading)
  if (!session) return null
  return (
    <aside data-instruments data-reading={reading} data-at={at ?? undefined} style={{ padding: '1.4em', borderLeft: '1px solid var(--line)', height: '100%', overflow: 'auto' }}>
      <Label>Context and tokens</Label>
      <p className="mn-num" style={{ fontSize: '2.4em', margin: '0.2em 0' }}>
        {session.context.percent ?? '–'}%
      </p>
      <Meter value={(session.context.percent ?? 0) / 100} width="100%" />
      <p>{tokens(sum(session.totals.tree))} spent by its tree</p>
      <Label>Memory</Label>
      <p>
        {session.memory.trail.injected.length} given · {session.memory.trail.considered.length} held back
      </p>
      <Label>Sight</Label>
      <p>
        {session.web.searches.length + session.web.fetches.length + session.web.pages.length} on the web · {session.files.edited.length} edited
      </p>
    </aside>
  )
}

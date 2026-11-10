// The frame: the top bar, the three views and what opens over them
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "The frame"). This is the seam's
// frame: it holds the pieces together so each can be seen in place. The frame piece owns it.

import { useEffect } from 'react'
import '@fontsource-variable/jura'
import '../ds/tokens.css'
import { Kbd, Label, Pill, Starfield, StateMark } from '../ds'
import { Instruments } from '../instruments'
import { OrbitView } from '../orbit'
import { Panels } from '../panels'
import { Roster } from '../roster'
import { startRuntime } from '../runtime'
import { ScoreView } from '../score'
import { Stage } from '../stage'
import { go, useRoute, type View } from '../world/route'
import { startWorld } from '../world/start'
import { useWorld, worldSource } from '../world/store'
import { STATE_ORDER } from '../world/types'

const VIEWS: [View, string][] = [
  ['orbit', 'Orbit'],
  ['console', 'Console'],
  ['score', 'Score'],
]

function TopBar() {
  const world = useWorld((w) => w)
  const view = useRoute((r) => r.view)
  return (
    <header data-top-bar style={{ display: 'flex', alignItems: 'center', gap: '1.4em', height: '3.4em', padding: '0 1.4em', borderBottom: '1px solid var(--line)' }}>
      <strong style={{ font: '700 1.1em/1 var(--display)', letterSpacing: '0.5em', textShadow: 'var(--glow)' }}>MNEMO</strong>
      {STATE_ORDER.filter((s) => s !== 'ended').map((state) => (
        <span key={state} data-state={state} style={{ display: 'inline-flex', gap: '0.4em', alignItems: 'baseline' }}>
          <StateMark state={state} /> <span className="mn-num">{world.sessions.filter((s) => s.state === state).length}</span>
        </span>
      ))}
      {world.pending.length > 0 && (
        <Pill tone="need">
          {world.pending.length} wait for you <Kbd>N</Kbd>
        </Pill>
      )}
      <span style={{ flex: 1 }} />
      {world.errors.map((e) => (
        <Label key={e}>{e}</Label>
      ))}
      {VIEWS.map(([id, name]) => (
        <Pill key={id} active={view === id} onClick={() => go({ view: id })}>
          {name}
        </Pill>
      ))}
    </header>
  )
}

export function Frame() {
  const route = useRoute((r) => r)
  useEffect(() => startWorld(), [])
  useEffect(() => (worldSource() === 'live' ? startRuntime() : undefined), [])
  return (
    <div className="mn" data-view={route.view} data-world={worldSource()}>
      <Starfield />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
        <TopBar />
        <main style={{ position: 'relative', minHeight: 0 }}>
          {route.view === 'orbit' && <OrbitView />}
          {route.view === 'console' && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: route.wide ? '24em 1fr' : '24em 1fr 30em' }}>
              <Roster />
              <Stage />
              {!route.wide && route.session && <Instruments sessionId={route.session} />}
            </div>
          )}
          {route.view === 'score' && <ScoreView />}
          <Panels />
        </main>
      </div>
    </div>
  )
}

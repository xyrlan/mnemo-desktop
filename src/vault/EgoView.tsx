import { useEffect, useMemo, useState } from 'react'
import { Graph } from '../graph'
import { useVault, vault } from './app-store'
import { egoFlow, firedIds, withGlow } from './ego'
import { pulseStore } from '../pulse/app-store'
import type { PulseStore } from '../pulse/store'
import type { VaultGraph } from './types'

/** How long a node a pulse names glows. */
export const GLOW_MS = 2000
const NONE: ReadonlySet<string> = new Set()

/** Ids of the nodes of `graph` that a pulse named in the last `GLOW_MS`. Only pulses that
 *  arrive while the graph is shown count: opening it later does not replay them. */
function useGlow(graph: VaultGraph | null, pulses: PulseStore): ReadonlySet<string> {
  const [glow, setGlow] = useState(NONE)
  useEffect(() => {
    if (!graph) return
    const until = new Map<string, number>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const expire = () => {
      const now = Date.now()
      for (const [id, t] of until) if (t <= now) until.delete(id)
      setGlow(until.size ? new Set(until.keys()) : NONE)
    }
    let seen = pulses.getState().log.at(-1)?.id ?? 0
    const unsubscribe = pulses.subscribe((s) => {
      const ids = s.log.filter((p) => p.id > seen).flatMap((p) => firedIds(graph, p.event.slugs))
      seen = s.log.at(-1)?.id ?? seen
      if (ids.length === 0) return
      for (const id of ids) until.set(id, Date.now() + GLOW_MS)
      setGlow(new Set(until.keys()))
      const timer = setTimeout(() => {
        timers.delete(timer)
        expire()
      }, GLOW_MS)
      timers.add(timer)
    })
    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
      setGlow(NONE)
    }
  }, [graph, pulses])
  return glow
}

const LEGEND = [
  ['ok', 'verified'],
  ['accent', 'elsewhere / ci'],
  ['warn', 'unrated'],
  ['bad', 'demoted'],
  ['muted', 'inferred or never fired'],
] as const

const EMPTY = { nodes: [], edges: [] }

/** The rule at `path` in the centre, the pages it links to and from, and the pages sharing its
 *  topics. A neighbour's click selects it; a pulse naming a node makes it glow. */
export function EgoView({ path, pulses = pulseStore }: { path: string; pulses?: PulseStore }) {
  const ego = useVault((s) => s.ego)
  const loading = useVault((s) => s.egoLoading)
  useEffect(() => {
    if (vault.getState().ego?.center !== path) void vault.getState().loadEgo(path)
  }, [path])

  const shown = ego?.center === path ? ego : null
  const laidOut = useMemo(() => (shown ? egoFlow(shown) : EMPTY), [shown])
  const glow = useGlow(shown, pulses)
  const flow = useMemo(() => withGlow(laidOut, glow), [laidOut, glow])
  const neighbours = Math.max(0, (shown?.nodes.length ?? 0) - 1)

  return (
    <section className="ve">
      <div className="ve-bar">
        <span className="ve-title">Neighbourhood</span>
        {shown && !shown.error && (
          <span className="vt-count">{neighbours < shown.total ? `${neighbours} of ${shown.total} neighbours` : `${neighbours} neighbours`}</span>
        )}
        <span className="vg-legend" title="Card colour is confidence; solid edges are links, dashed ones shared topics">
          {LEGEND.map(([tone, text]) => (
            <span key={tone}>
              <i className={`vg-dot gr-${tone}`} />
              {text}
            </span>
          ))}
        </span>
      </div>
      <div className="ve-canvas">
        {shown?.error && <pre className="vt-error ve-msg">{shown.error}</pre>}
        {!shown && <div className="vt-empty ve-msg">{loading ? 'reading the neighbourhood…' : ''}</div>}
        {shown && !shown.error && neighbours === 0 && <div className="vt-empty ve-msg">No links and no shared topics.</div>}
        {flow.nodes.length > 0 && <Graph nodes={flow.nodes} edges={flow.edges} fitKey={path} fitMinZoom={0.85} onNodeClick={(id) => id !== path && void vault.getState().select(id)} />}
      </div>
    </section>
  )
}

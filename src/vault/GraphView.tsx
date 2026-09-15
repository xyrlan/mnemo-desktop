import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Graph } from '../graph'
import { useVault, vault } from './app-store'
import { firedIds, hubTopic, scopeOptions, toFlow, withGlow } from './graph'
import { HealthPanel } from './HealthPanel'
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

/** Obsidian-style graph of one agent or one topic, with the health panel (or the clicked
 *  page, rendered by `page`) beside it. */
export function GraphView({ cwd, current, page, pulses = pulseStore }: { cwd: string | undefined; current: string | undefined; page: ReactNode; pulses?: PulseStore }) {
  const tree = useVault((s) => s.tree)
  const scope = useVault((s) => s.scope)
  const graph = useVault((s) => s.graph)
  const loading = useVault((s) => s.graphLoading)
  const [side, setSide] = useState<'health' | 'page'>('health')

  const { agents, topics } = useMemo(() => scopeOptions(tree), [tree])
  const fallback = `agent:${current ?? 'shared'}`
  useEffect(() => {
    if (vault.getState().scope === null) void vault.getState().loadGraph(fallback)
  }, [fallback])

  const laidOut = useMemo(() => (graph ? toFlow(graph) : { nodes: [], edges: [] }), [graph])
  const glow = useGlow(graph, pulses)
  const flow = useMemo(() => withGlow(laidOut, glow), [laidOut, glow])
  const rules = graph?.nodes.filter((n) => n.kind === 'rule').length ?? 0
  const topicScope = scope?.startsWith('topic:') ? scope.slice('topic:'.length) : null

  const open = (path: string) => {
    if (!path) return
    void vault.getState().select(path)
    setSide('page')
  }
  const click = (id: string) => {
    const topic = hubTopic(id)
    if (topic !== null) void vault.getState().loadGraph(`topic:${topic}`)
    else open(id)
  }

  return (
    <div className="vg">
      <div className="vg-bar">
        <select value={scope ?? ''} onChange={(e) => void vault.getState().loadGraph(e.target.value)} title="What the graph shows">
          <optgroup label="agent">
            {agents.map((a) => (
              <option key={a} value={`agent:${a}`}>
                {a}
              </option>
            ))}
          </optgroup>
          <optgroup label="topic">
            {topicScope && !topics.some((t) => t.name === topicScope) && <option value={scope!}>#{topicScope}</option>}
            {topics.map((t) => (
              <option key={t.name} value={`topic:${t.name}`}>
                #{t.name} ({t.count})
              </option>
            ))}
          </optgroup>
        </select>
        <button title="Re-read the graph" disabled={loading || !scope} onClick={() => scope && void vault.getState().loadGraph(scope)}>
          {loading ? '…' : '↻'}
        </button>
        {graph && !graph.error && (
          <span className="vt-count">
            {rules < graph.total ? `${rules} hottest of ${graph.total} rules` : `${rules} rules`} · {graph.edges.filter((e) => e.kind === 'link').length} links
          </span>
        )}
        <span className="vg-legend" title="Card colour is confidence; size and badge are times fired">
          {LEGEND.map(([tone, text]) => (
            <span key={tone}>
              <i className={`vg-dot gr-${tone}`} />
              {text}
            </span>
          ))}
        </span>
      </div>
      <div className="vg-main">
        <div className="vg-canvas">
          {graph?.error && <pre className="vt-error vg-msg">{graph.error}</pre>}
          {!graph && <div className="vt-empty vg-msg">{loading ? 'reading the graph…' : 'Pick an agent or a topic.'}</div>}
          {graph && !graph.error && graph.nodes.length === 0 && <div className="vt-empty vg-msg">No rules in {graph.scope}.</div>}
          {flow.nodes.length > 0 && <Graph nodes={flow.nodes} edges={flow.edges} onNodeClick={click} />}
        </div>
        <aside className="vg-side">
          <div className="vg-tabs">
            <button className={side === 'health' ? 'vg-on' : ''} onClick={() => setSide('health')}>
              Health
            </button>
            <button className={side === 'page' ? 'vg-on' : ''} onClick={() => setSide('page')}>
              Page
            </button>
          </div>
          {side === 'health' ? <HealthPanel cwd={cwd} onOpen={open} /> : page}
        </aside>
      </div>
    </div>
  )
}

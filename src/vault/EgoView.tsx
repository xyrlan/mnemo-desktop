import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/ui/cn'
import { Graph } from '../graph'
import { useVault, vault } from './app-store'
import { countLabel, egoFlow, firedIds, GHOST, withGlow } from './ego'
import { pulseStore } from '../pulse/app-store'
import type { PulseStore } from '../pulse/store'
import { ErrorLine } from './ErrorLine'
import { Dot, EMPTY, Loading } from './ui'
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

const NO_FLOW = { nodes: [], edges: [] }

/** The rule at `path` in the centre, the pages it links to and from, and the pages sharing its
 *  topics. A neighbour's click selects it; a pulse naming a node makes it glow. */
export function EgoView({ path, pulses = pulseStore }: { path: string; pulses?: PulseStore }) {
  const ego = useVault((s) => s.ego)
  useEffect(() => {
    if (vault.getState().ego?.center !== path) void vault.getState().loadEgo(path)
  }, [path])

  const shown = ego?.center === path ? ego : null
  const laidOut = useMemo(() => (shown ? egoFlow(shown) : NO_FLOW), [shown])
  const glow = useGlow(shown, pulses)
  const flow = useMemo(() => withGlow(laidOut, glow), [laidOut, glow])
  const neighbours = Math.max(0, (shown?.nodes.length ?? 0) - 1)
  // Dismissing hides this read's error; the next read (another rule) shows its own.
  const [dismissed, setDismissed] = useState<VaultGraph | null>(null)

  return (
    <section className="ve flex min-h-[200px] flex-1 basis-1/2 flex-col">
      <div className="ve-bar flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        {shown && !shown.error && <span className="vt-count text-[11px] text-muted-foreground tabular-nums">{countLabel(shown)}</span>}
        <span className="vg-legend ml-auto flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" title="Card colour is confidence; solid edges are links, dashed ones shared topics">
          {LEGEND.map(([tone, text]) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <Dot tone={tone} className="vg-dot" />
              {text}
            </span>
          ))}
        </span>
      </div>
      <div className="ve-canvas relative mx-3 mb-3 min-h-[320px] flex-1 overflow-hidden rounded-lg border border-border bg-card/40">
        {shown?.error && dismissed !== shown && <ErrorLine text={shown.error} onDismiss={() => setDismissed(shown)} className="ve-msg absolute top-2 right-2 left-2 z-[5]" />}
        {/* Not yet read is always a read in flight: the mount starts one before the first paint. */}
        {!shown && <Loading className="ve-msg absolute top-0 left-0 z-[5]">reading the neighbourhood…</Loading>}
        {shown && !shown.error && neighbours === 0 && <div className={cn('vt-empty ve-msg absolute top-0 left-0 z-[5]', EMPTY, 'px-3')}>No links and no shared topics.</div>}
        {flow.nodes.length > 0 && <Graph nodes={flow.nodes} edges={flow.edges} fitKey={path} fitMinZoom={0.85} onNodeClick={(id) => id !== path && !id.startsWith(GHOST) && void vault.getState().select(id)} />}
      </div>
    </section>
  )
}

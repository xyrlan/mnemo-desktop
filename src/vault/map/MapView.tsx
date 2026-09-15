import { useEffect, useRef, useState } from 'react'
import { useVault, vault } from '../app-store'
import { EgoView } from '../EgoView'
import { PageView } from '../PageView'
import { scopeAgents } from '../rules'
import type { PulseStore } from '../../pulse/store'
import type { MapClient } from './client'
import { agentsOf, readPalette } from './model'
import type { Renderer, RendererOptions } from './renderer'
import { mapStore, useMap } from './store'
import type { Positions, VaultMap } from './types'

/** Born and changed events closer than this re-read the map once. */
export const RELOAD_MS = 400
/** Positions are written this long after the last layout, drag or placement. */
export const SAVE_MS = 800

export type MapDeps = {
  client: MapClient
  createRenderer(container: HTMLElement, map: VaultMap, positions: Positions, opts: RendererOptions): Promise<Renderer>
  pulses: PulseStore
  readVar(name: string): string
}

const LEGEND = [
  ['ok', 'verified'],
  ['accent', 'elsewhere / ci'],
  ['warn', 'unrated'],
  ['bad', 'demoted'],
  ['muted', 'inferred or never fired'],
] as const

/** A proposal staged in an `_inbox`: a page of its own, but no rule to show a neighbourhood of. */
export const isProposal = (path: string) => path.includes('/_inbox/')

type Counts = { rules: number; links: number; proposals: number }

const countsOf = (map: VaultMap): Counts => ({
  rules: map.nodes.filter((n) => !n.ghost).length,
  links: map.edges.filter((e) => e.kind === 'link').length,
  proposals: map.nodes.filter((n) => n.ghost).length,
})

/** The vault's living map: every rule of the scope as a point (colour = confidence, size = heat),
 *  wikilinks and rare shared topics as edges, proposals as hollow ghosts. Rules flash when mnemo
 *  fires them and pulse in when they are born; a click opens the rule beside the map. */
export function MapView({ cwd, current, deps }: { cwd: string | undefined; current: string | undefined; deps: MapDeps }) {
  const scope = useMap((s) => s.scope)
  const mapAgents = useMap((s) => s.agents)
  const tableAgents = useVault((s) => s.agents)
  const selected = useVault((s) => s.selected)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [layingOut, setLayingOut] = useState(false)
  const [ready, setReady] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const reload = useRef<() => void>(() => {})
  const { client } = deps

  const note = (map: VaultMap, forScope: string) => {
    if (!forScope) mapStore.getState().noteAgents(agentsOf(map))
    setCounts(countsOf(map))
  }

  // One renderer per scope: its layout and saved positions are the scope's.
  useEffect(() => {
    let dead = false
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let pending: Positions | null = null
    const flush = () => {
      clearTimeout(saveTimer)
      if (pending) void client.savePositions(scope, pending).catch(() => {})
      pending = null
    }
    const save = (p: Positions) => {
      pending = p
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flush, SAVE_MS)
    }
    setLoading(true)
    setError(null)
    setCounts(null)
    void (async () => {
      try {
        const [map, positions] = await Promise.all([client.map(scope), client.positions(scope).catch((): Positions => ({}))])
        if (dead) return
        if (map.error) return setError(map.error)
        note(map, scope)
        if (!host.current) return
        const made = await deps.createRenderer(host.current, map, positions, {
          palette: readPalette(deps.readVar),
          onSelect: (path) => void vault.getState().select(path),
          onPositions: save,
          onLayout: (running) => !dead && setLayingOut(running),
        })
        if (dead) return made.destroy()
        renderer.current = made
        made.select(vault.getState().selected)
        setReady(true)
      } catch (e) {
        if (!dead) setError(String(e))
      } finally {
        if (!dead) setLoading(false)
      }
    })()
    return () => {
      dead = true
      flush()
      renderer.current?.destroy()
      renderer.current = null
      setReady(false)
      setLayingOut(false)
    }
    // `deps` is fixed for the pane's life.
  }, [scope, client])

  // Born and changed pages: re-read the map and let the renderer bring itself to it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let read = 0
    const now = async () => {
      const n = ++read
      const map = await client.map(scope).catch(() => null)
      if (!map || map.error || n !== read || !renderer.current) return
      note(map, scope)
      renderer.current.update(map)
    }
    reload.current = () => void now()
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void now(), RELOAD_MS)
    }
    const offs = [client.onBorn(soon), client.onChanged(soon)]
    return () => {
      clearTimeout(timer)
      read++
      reload.current = () => {}
      offs.forEach((off) => void off.then((f) => f()).catch(() => {}))
    }
  }, [scope, client])

  // Rules mnemo fires flash; only pulses arriving while the map is open count.
  useEffect(() => {
    const pulses = deps.pulses
    let seen = pulses.getState().log.at(-1)?.id ?? 0
    return pulses.subscribe((s) => {
      const slugs = s.log.filter((p) => p.id > seen).flatMap((p) => p.event.slugs)
      seen = s.log.at(-1)?.id ?? seen
      if (slugs.length) renderer.current?.fire(slugs)
    })
  }, [deps.pulses])

  useEffect(() => renderer.current?.select(selected), [selected, ready])

  useEffect(() => {
    if (!host.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => renderer.current?.resize())
    ro.observe(host.current)
    return () => ro.disconnect()
  }, [])

  const agents = scopeAgents([...mapAgents, ...tableAgents], current)
  return (
    <div className="vm">
      <div className="vm-bar">
        <select value={scope} title="Whose rules" onChange={(e) => mapStore.getState().setScope(e.target.value)}>
          <option value="">every agent</option>
          {agents.map((a) => (
            <option key={a} value={`agent:${a}`}>
              {a}
            </option>
          ))}
        </select>
        <span className="vt-count">
          {counts ? `${counts.rules} rules · ${counts.links} links${counts.proposals ? ` · ${counts.proposals} proposals` : ''}` : loading ? 'reading the vault…' : ''}
        </span>
        <button title="Run the force layout again for 3 s; positions are saved when it settles" disabled={!ready || layingOut} onClick={() => renderer.current?.relayout()}>
          {layingOut ? 'laying out…' : 'Re-layout'}
        </button>
        <button title="Re-read the vault" disabled={!ready} onClick={() => reload.current()}>
          ↻
        </button>
        <span className="vg-legend" title="Colour is confidence, size is heat; solid edges are links, faint ones rare shared topics">
          {LEGEND.map(([tone, text]) => (
            <span key={tone}>
              <i className={`vg-dot gr-${tone}`} />
              {text}
            </span>
          ))}
          <span>
            <i className="vm-ring" />
            proposal
          </span>
        </span>
      </div>
      <div className="vm-main">
        <div className="vm-canvas">
          <div className="vm-sigma" ref={host} />
          {error && <pre className="vt-error ve-msg">{error}</pre>}
          {!error && loading && <div className="vt-empty ve-msg">reading the vault…</div>}
          {!error && !loading && counts?.rules === 0 && <div className="vt-empty ve-msg">No rules in this scope.</div>}
        </div>
        {selected && (
          <aside className="vr-side">
            <PageView cwd={cwd} empty="Select a rule." />
            {!isProposal(selected) && <EgoView path={selected} />}
          </aside>
        )}
      </div>
    </div>
  )
}

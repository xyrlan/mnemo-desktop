import Graph from 'graphology'
import { confidenceTone, type Tone } from '../rules'
import type { MapEdge, MapEdgeKind, MapNode, Positions, VaultMap } from './types'

/** Colours of the map, read from the theme's CSS variables once per renderer. */
export type Palette = Record<Tone, string> & {
  bg: string
  bgElev: string
  label: string
  /** Topic edges, before their alpha. */
  edge: string
  link: string
  rewrite: string
  /** What a firing node flashes towards. */
  glow: string
}

const FALLBACK: Palette = {
  ok: '#9ece6a',
  accent: '#7aa2f7',
  warn: '#e0af68',
  bad: '#f7768e',
  muted: '#7c8394',
  bg: '#0f1116',
  bgElev: '#161923',
  label: '#d6dae3',
  edge: '#7c8394',
  link: '#7dcfff',
  rewrite: '#bb9af7',
  glow: '#ffc777',
}

/** `#abc` → `#aabbcc`; anything that is not hex keeps the fallback. */
function hex(value: string, fallback: string): string {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
  return fallback
}

export function readPalette(read: (name: string) => string): Palette {
  const v = (name: string, key: keyof Palette) => hex(read(name), FALLBACK[key])
  return {
    ok: v('--ansi-green', 'ok'),
    accent: v('--accent', 'accent'),
    warn: v('--ansi-yellow', 'warn'),
    bad: v('--ansi-red', 'bad'),
    muted: v('--fg-muted', 'muted'),
    bg: v('--bg', 'bg'),
    bgElev: v('--bg-elev', 'bgElev'),
    label: v('--fg', 'label'),
    edge: v('--fg-muted', 'edge'),
    link: v('--ansi-cyan', 'link'),
    rewrite: v('--ansi-magenta', 'rewrite'),
    glow: v('--ansi-bright-yellow', 'glow'),
  }
}

const channels = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`

/** `a` at `t = 0`, `b` at `t = 1`; both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)]
  const k = Math.max(0, Math.min(1, t))
  return toHex(x.map((c, i) => c + (y[i] - c) * k))
}

/** `#rrggbb` → `#rrggbbaa`, which sigma reads. */
export const withAlpha = (h: string, alpha: number) => h.slice(0, 7) + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')

/** Confidence colour, but a rule that never fired is grey whatever it claims (as in the ego view). */
export const toneOf = (n: MapNode): Tone => (n.fires === 0 && !n.ghost ? 'muted' : confidenceTone(n.confidence))

export const MIN_SIZE = 2.5
export const MAX_SIZE = 14
/** Node radius from heat: a month-old fire barely shows, a rule firing all day stands out. */
export const sizeFor = (heat: number) => Math.min(MAX_SIZE, MIN_SIZE + 2.2 * Math.sqrt(Math.max(0, heat)))

export type NodeAttrs = {
  x: number
  y: number
  size: number
  color: string
  label: string
  /** Sigma's program: `circle`, or `ghost` (hollow). */
  type: 'circle' | 'ghost'
  slug: string
  agent: string
  ghost: boolean
  heat: number
}

export type EdgeAttrs = { kind: MapEdgeKind; color: string; size: number }

export type MapGraph = Graph<NodeAttrs, EdgeAttrs>

export const edgeKey = (e: MapEdge) => `${e.kind}:${e.source}->${e.target}`

export function edgeAttrs(kind: MapEdgeKind, p: Palette): EdgeAttrs {
  if (kind === 'link') return { kind, color: withAlpha(p.link, 0.55), size: 1 }
  if (kind === 'rewrite') return { kind, color: withAlpha(p.rewrite, 0.7), size: 1 }
  return { kind, color: withAlpha(p.edge, 0.14), size: 0.5 }
}

function nodeAttrs(n: MapNode, p: Palette): Omit<NodeAttrs, 'x' | 'y'> {
  return {
    size: n.ghost ? 4 : sizeFor(n.heat),
    color: p[toneOf(n)],
    label: n.name || n.slug,
    type: n.ghost ? 'ghost' : 'circle',
    slug: n.slug,
    agent: n.agent,
    ghost: n.ghost,
    heat: n.heat,
  }
}

/** A stable number in [0, 1) for `s`: the same page lands in the same spot every time. */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0) / 0x100000000
}

const RANK: Record<MapEdgeKind, number> = { link: 0, rewrite: 1, topic: 2 }

/** Where nodes without a position go: beside their strongest placed neighbour (a link over a
 *  rewrite over a topic, then the hottest), else somewhere in the placed area. Placing runs in
 *  passes, so a chain of new pages grows out from the first one that has a placed neighbour. */
function place(ids: string[], graph: MapGraph, has: (id: string) => boolean, at: (id: string) => [number, number], set: (id: string, xy: [number, number]) => void) {
  const placed = graph.nodes().filter(has)
  const xs = placed.map((id) => at(id)[0])
  const ys = placed.map((id) => at(id)[1])
  const b = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null
  const spread = b ? Math.max(1, Math.hypot(b.x1 - b.x0, b.y1 - b.y0)) : Math.max(10, Math.sqrt(graph.order) * 10)
  /** About the gap between neighbours in a laid-out map of this many nodes. */
  const step = spread / Math.max(4, Math.sqrt(Math.max(1, placed.length)))

  let pending = ids.filter((id) => !has(id))
  for (let pass = 0; pending.length && pass < 4; pass++) {
    const next: string[] = []
    for (const id of pending) {
      let best: { id: string; rank: number; heat: number } | null = null
      graph.forEachEdge(id, (_e, attrs, source, target) => {
        const other = source === id ? target : source
        if (!has(other)) return
        const cand = { id: other, rank: RANK[attrs.kind], heat: graph.getNodeAttribute(other, 'heat') }
        if (!best || cand.rank < best.rank || (cand.rank === best.rank && cand.heat > best.heat)) best = cand
      })
      if (!best) {
        next.push(id)
        continue
      }
      const [x, y] = at((best as { id: string }).id)
      const angle = hash01(id, 1) * Math.PI * 2
      const r = step * (0.6 + 0.4 * hash01(id, 2))
      set(id, [x + Math.cos(angle) * r, y + Math.sin(angle) * r])
    }
    if (next.length === pending.length) break
    pending = next
  }
  const area = b ?? { x0: -spread / 2, x1: spread / 2, y0: -spread / 2, y1: spread / 2 }
  for (const id of pending) set(id, [area.x0 + hash01(id, 3) * (area.x1 - area.x0 || spread), area.y0 + hash01(id, 4) * (area.y1 - area.y0 || spread)])
}

/** The graph of `map`, every node at its saved position or placed beside a neighbour. `missing`
 *  counts the nodes that had no saved position. */
export function buildGraph(map: VaultMap, positions: Positions, palette: Palette): { graph: MapGraph; missing: number } {
  const graph: MapGraph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false })
  for (const n of map.nodes) {
    if (graph.hasNode(n.path)) continue
    const xy = positions[n.path]
    graph.addNode(n.path, { x: xy?.[0] ?? NaN, y: xy?.[1] ?? NaN, ...nodeAttrs(n, palette) })
  }
  addEdges(graph, map.edges, palette)
  const has = (id: string) => Number.isFinite(graph.getNodeAttribute(id, 'x')) && Number.isFinite(graph.getNodeAttribute(id, 'y'))
  const missing = graph.filterNodes((id) => !has(id))
  place(missing, graph, has, (id) => [graph.getNodeAttribute(id, 'x'), graph.getNodeAttribute(id, 'y')], (id, [x, y]) => graph.mergeNodeAttributes(id, { x, y }))
  return { graph, missing: missing.length }
}

function addEdges(graph: MapGraph, edges: MapEdge[], palette: Palette): string[] {
  const added: string[] = []
  for (const e of edges) {
    const key = edgeKey(e)
    if (e.source === e.target || !graph.hasNode(e.source) || !graph.hasNode(e.target) || graph.hasEdge(key) || graph.hasEdge(e.source, e.target)) continue
    graph.addEdgeWithKey(key, e.source, e.target, edgeAttrs(e.kind, palette))
    added.push(key)
  }
  return added
}

/** Lay the map out afresh when more than half its nodes have nowhere saved to be. */
export const needsLayout = (order: number, missing: number) => order > 1 && missing * 2 > order

export type Recolour = { id: string; from: string; to: string }

export type MapDelta = { added: string[]; removed: string[]; recoloured: Recolour[]; edgesAdded: string[] }

/** Brings `graph` to `map` in place: gone nodes and edges leave, new ones are placed beside
 *  their neighbours, and every kept node keeps its position. */
export function applyMap(graph: MapGraph, map: VaultMap, palette: Palette): MapDelta {
  const want = new Map(map.nodes.map((n) => [n.path, n]))
  const removed = graph.filterNodes((id) => !want.has(id))
  removed.forEach((id) => graph.dropNode(id))

  const added: string[] = []
  const recoloured: Recolour[] = []
  for (const n of want.values()) {
    const attrs = nodeAttrs(n, palette)
    if (!graph.hasNode(n.path)) {
      graph.addNode(n.path, { x: NaN, y: NaN, ...attrs })
      added.push(n.path)
      continue
    }
    const from = graph.getNodeAttribute(n.path, 'color')
    if (from !== attrs.color) recoloured.push({ id: n.path, from, to: attrs.color })
    graph.mergeNodeAttributes(n.path, attrs)
  }

  const keys = new Set(map.edges.map(edgeKey))
  graph.filterEdges((key) => !keys.has(key)).forEach((key) => graph.dropEdge(key))
  const edgesAdded = addEdges(graph, map.edges, palette)

  const isNew = new Set(added)
  const has = (id: string) => !isNew.has(id) || Number.isFinite(graph.getNodeAttribute(id, 'x'))
  place(added, graph, has, (id) => [graph.getNodeAttribute(id, 'x'), graph.getNodeAttribute(id, 'y')], (id, [x, y]) => {
    graph.mergeNodeAttributes(id, { x, y })
    isNew.delete(id)
  })
  return { added, removed, recoloured, edgesAdded }
}

export function positionsOf(graph: MapGraph): Positions {
  const out: Positions = {}
  graph.forEachNode((id, a) => {
    if (Number.isFinite(a.x) && Number.isFinite(a.y)) out[id] = [a.x, a.y]
  })
  return out
}

/** Slug and name → node ids: what a pulse's slugs name. Ghosts never fire. */
export function slugIndex(graph: MapGraph): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const add = (k: string, id: string) => {
    const ids = index.get(k)
    if (!ids) index.set(k, [id])
    else if (!ids.includes(id)) ids.push(id)
  }
  graph.forEachNode((id, a) => {
    if (a.ghost) return
    add(a.slug, id)
    add(a.label, id)
  })
  return index
}

export function firedIds(index: Map<string, string[]>, slugs: readonly string[]): string[] {
  return [...new Set(slugs.flatMap((s) => index.get(s) ?? []))]
}

/** The agents a map names, `shared` first. */
export const agentsOf = (map: VaultMap) => [...new Set(map.nodes.map((n) => n.agent))].sort((a, b) => (a === 'shared' ? -1 : b === 'shared' ? 1 : a.localeCompare(b)))

import type { Edge } from '@xyflow/react'
import { layoutDagre, type CardData, type CardNode } from '../graph'
import { confidenceTone } from './rules'
import type { GraphNode, VaultGraph } from './types'

/** Nodes the ego view asks for, its centre included; the Rust side never returns more. */
export const EGO_LIMIT = 12

/** The card box the layout reserves; `.gr-card` is 160–240 px wide. */
const CARD = { width: 170, height: 48 }

/** Confidence colour, but a rule that never fired is grey whatever it claims. */
export function toneFor(n: GraphNode): CardData['tone'] {
  return n.fires === 0 ? 'muted' : confidenceTone(n.confidence)
}

/** `items` cut into columns of `rows`. */
export function columns<T>(items: T[], rows: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += rows) out.push(items.slice(i, i + rows))
  return out
}

/** Rows per column for `n` cards: a roughly square block, 4 to 8 tall. */
export const rowsFor = (n: number) => Math.min(8, Math.max(4, Math.ceil(Math.sqrt(n))))

function sub(n: GraphNode, relation: string | null): string {
  if (relation !== null) return relation
  return [n.type, n.confidence ?? 'no confidence', n.fires ? `${n.fires}× fired` : 'never fired'].join(' · ')
}

/** The React Flow cards and edges of an ego graph, laid out by dagre left to right: pages that
 *  only link to the centre on its left, the centre, then everything else in columns on its
 *  right. Layout-only edges chain each column to the next; the drawn edges are the graph's. */
export function egoFlow(g: VaultGraph): { nodes: CardNode[]; edges: Edge[] } {
  if (g.nodes.length === 0) return { nodes: [], edges: [] }
  const c = g.nodes[0].id
  const links = g.edges.filter((e) => e.kind === 'link')
  const inbound = new Set(links.filter((e) => e.target === c).map((e) => e.source))
  const outbound = new Set(links.filter((e) => e.source === c).map((e) => e.target))
  const topics = new Map(g.edges.filter((e) => e.kind === 'topic').map((e) => [e.target, e.label]))
  const rest = g.nodes.slice(1)
  const left = rest.filter((n) => inbound.has(n.id) && !outbound.has(n.id))
  const right = rest.filter((n) => !left.includes(n))

  const layout: Edge[] = []
  const chain = (cols: GraphNode[][], toward: 'left' | 'right') => {
    cols[0]?.forEach((n) => layout.push(toward === 'left' ? { id: `l:${n.id}`, source: n.id, target: c } : { id: `l:${n.id}`, source: c, target: n.id }))
    for (let k = 1; k < cols.length; k++)
      cols[k].forEach((n, j) => {
        const prev = cols[k - 1][Math.min(j, cols[k - 1].length - 1)].id
        layout.push(toward === 'left' ? { id: `l:${n.id}`, source: n.id, target: prev } : { id: `l:${n.id}`, source: prev, target: n.id })
      })
  }
  chain(columns(left, rowsFor(left.length)), 'left')
  chain(columns(right, rowsFor(right.length)), 'right')

  const relation = (n: GraphNode): string | null => {
    if (n.id === c) return null
    if (inbound.has(n.id) && outbound.has(n.id)) return 'links both ways'
    if (inbound.has(n.id)) return 'links here'
    if (outbound.has(n.id)) return 'linked from here'
    const t = topics.get(n.id)
    return t ? t.split(', ').map((x) => `#${x}`).join(' ') : ''
  }
  const cards: CardNode[] = g.nodes.map((n) => ({
    id: n.id,
    type: 'card',
    position: { x: 0, y: 0 },
    className: n.id === c ? 've-centre' : undefined,
    data: { label: n.label, sub: sub(n, relation(n)), badge: n.fires ? `${n.fires}×` : undefined, tone: toneFor(n) },
  }))
  const nodes = layoutDagre(cards, layout, { width: CARD.width, height: CARD.height, gap: 18 })
  const edges: Edge[] = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, className: `ve-edge-${e.kind}` }))
  return { nodes, edges }
}

/** The nodes of `g` that the pulse slugs name (by slug, or by name as MCP reads may). */
export function firedIds(g: VaultGraph, slugs: readonly string[]): string[] {
  if (slugs.length === 0) return []
  const want = new Set(slugs)
  return g.nodes.filter((n) => want.has(n.slug) || want.has(n.label)).map((n) => n.id)
}

/** `ve-glow` on the glowing nodes and `ve-edge-glow` on their edges. Positions are untouched
 *  and every other node and edge is the same object, so nothing is laid out again. */
export function withGlow(flow: { nodes: CardNode[]; edges: Edge[] }, ids: ReadonlySet<string>): { nodes: CardNode[]; edges: Edge[] } {
  if (ids.size === 0) return flow
  return {
    nodes: flow.nodes.map((n) => (ids.has(n.id) ? { ...n, className: `${n.className ?? ''} ve-glow`.trim() } : n)),
    edges: flow.edges.map((e) => (ids.has(e.source) || ids.has(e.target) ? { ...e, className: `${e.className ?? ''} ve-edge-glow`.trim(), animated: true } : e)),
  }
}

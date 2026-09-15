import type { Edge } from '@xyflow/react'
import type { CardData, CardNode } from '../graph'
import { layoutForce } from './force'
import type { Agent, GraphNode, VaultGraph } from './types'

/** The card box the layout reserves; `.gr-card` is 160–240 px wide. */
const CARD = { width: 200, height: 52 }

/** Colour = confidence (verified green, verified elsewhere / by CI accent, inferred grey,
 *  demoted red, anything else yellow), but a rule that never fired is grey whatever it claims. */
export function toneFor(n: GraphNode): CardData['tone'] {
  if (n.kind === 'topic') return 'accent'
  if (n.fires === 0) return 'muted'
  const c = (n.confidence ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (c === 'verified') return 'ok'
  if (c === 'ci' || c.startsWith('verified-')) return 'accent'
  if (c === 'inferred') return 'muted'
  if (c === 'demoted') return 'bad'
  return 'warn'
}

/** 0 for never fired, else 1–3 on a log scale against the hottest rule: the card's size. */
export function heat(fires: number, max: number): 0 | 1 | 2 | 3 {
  if (fires <= 0) return 0
  const r = max <= 1 ? 1 : Math.log1p(fires) / Math.log1p(max)
  return r > 0.8 ? 3 : r > 0.5 ? 2 : 1
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function sub(n: GraphNode): string {
  if (n.kind === 'topic') return `${n.fires} rules`
  const parts = [n.type, n.confidence ?? 'no confidence']
  parts.push(n.fires ? `last ${n.last_fired ? day(n.last_fired) : 'unknown'}` : 'never fired')
  return parts.join(' · ')
}

/** The React Flow nodes and edges of a vault graph, laid out by force. */
export function toFlow(g: VaultGraph): { nodes: CardNode[]; edges: Edge[] } {
  const max = Math.max(0, ...g.nodes.filter((n) => n.kind === 'rule').map((n) => n.fires))
  const pos = layoutForce(
    g.nodes.map((n) => n.id),
    g.edges.map((e) => [e.source, e.target]),
  )
  const nodes: CardNode[] = g.nodes.map((n) => ({
    id: n.id,
    type: 'card',
    position: { x: pos[n.id].x * 1.4 - CARD.width / 2, y: pos[n.id].y - CARD.height / 2 },
    className: n.kind === 'topic' ? 'vg-topic' : `vg-heat-${heat(n.fires, max)}`,
    data: { label: n.label, sub: sub(n), badge: n.kind === 'rule' && n.fires ? `${n.fires}×` : undefined, tone: toneFor(n) },
  }))
  const edges: Edge[] = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, className: `vg-edge-${e.kind}` }))
  return { nodes, edges }
}

/** A hub id names its topic: `topic:testing` → `testing`. */
export const hubTopic = (id: string) => (id.startsWith('topic:') ? id.slice('topic:'.length) : null)

/** The scopes to offer: `shared` and repo agents, then topics by how many pages carry them. */
export function scopeOptions(tree: Agent[], maxTopics = 80): { agents: string[]; topics: { name: string; count: number }[] } {
  const live = tree.filter((a) => a.kind !== 'other')
  const counts = new Map<string, number>()
  for (const a of live)
    for (const g of a.groups)
      for (const p of g.pages) for (const t of new Set(p.topics.map((x) => x.trim().toLowerCase()).filter(Boolean))) counts.set(t, (counts.get(t) ?? 0) + 1)
  const topics = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { agents: live.map((a) => a.name), topics: topics.slice(0, maxTopics) }
}

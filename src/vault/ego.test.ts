import { columns, egoFlow, firedIds, rowsFor, toneFor, withGlow } from './ego'
import type { GraphEdge, GraphNode, VaultGraph } from './types'

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  label: id,
  slug: id,
  type: 'feedback',
  confidence: 'verified',
  topics: [],
  fires: 2,
  last_fired: null,
  ...over,
})
const link = (source: string, target: string): GraphEdge => ({ id: `link:${source}->${target}`, source, target, kind: 'link', label: '' })
const topic = (target: string, label: string): GraphEdge => ({ id: `topic:c->${target}`, source: 'c', target, kind: 'topic', label })

test('grey when never fired, else the confidence colour', () => {
  expect(toneFor(node('a'))).toBe('ok')
  expect(toneFor(node('a', { fires: 0 }))).toBe('muted')
  expect(toneFor(node('a', { confidence: 'demoted' }))).toBe('bad')
})

test('columns cut items into blocks of 4 to 8 rows', () => {
  expect(columns([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect([0, 5, 29, 100].map(rowsFor)).toEqual([4, 4, 6, 8])
})

test('linkers sit left of the centre, everything else right, with relation and fires on the card', () => {
  const g: VaultGraph = {
    center: 'c',
    total: 4,
    error: null,
    nodes: [node('c', { fires: 3 }), node('in'), node('out', { fires: 0, confidence: null }), node('both'), node('t')],
    edges: [link('in', 'c'), link('c', 'out'), link('c', 'both'), link('both', 'c'), topic('t', 'testing, git'), link('t', 'out')],
  }
  const { nodes, edges } = egoFlow(g)
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]))
  expect(by.in.position.x).toBeLessThan(by.c.position.x)
  for (const id of ['out', 'both', 't']) expect(by[id].position.x).toBeGreaterThan(by.c.position.x)
  expect(nodes.map((n) => [n.id, n.className, n.data.sub, n.data.badge, n.data.tone])).toEqual([
    ['c', 've-centre', 'feedback · verified · 3× fired', '3×', 'ok'],
    ['in', undefined, 'links here', '2×', 'ok'],
    ['out', undefined, 'linked from here', undefined, 'muted'],
    ['both', undefined, 'links both ways', '2×', 'ok'],
    ['t', undefined, '#testing #git', '2×', 'ok'],
  ])
  // Drawn edges are the graph's own, never the layout's chains.
  expect(edges.map((e) => [e.id, e.className])).toEqual(g.edges.map((e) => [e.id, `ve-edge-${e.kind}`]))
  expect(egoFlow({ ...g, nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
})

test('a full neighbourhood lays out as a block of columns, not one tall line', () => {
  const rest = Array.from({ length: 29 }, (_, i) => node(`n${i}`))
  const g: VaultGraph = { center: 'c', total: 60, error: null, nodes: [node('c'), ...rest], edges: rest.map((n) => topic(n.id, 'a')) }
  const { nodes } = egoFlow(g)
  const xs = new Set(nodes.slice(1).map((n) => Math.round(n.position.x)))
  const ys = new Set(nodes.slice(1).map((n) => Math.round(n.position.y)))
  expect(xs.size).toBe(5)
  expect(ys.size).toBeLessThanOrEqual(8)
  for (const n of nodes) expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true)
})

test('firedIds finds the nodes a pulse names, by slug or name', () => {
  const g: VaultGraph = { center: 'a', total: 1, error: null, nodes: [node('/v/a.md', { slug: 'a' }), node('/v/b.md', { slug: 'b', label: 'Rule B' })], edges: [] }
  expect(firedIds(g, ['a', 'Rule B', 'nope'])).toEqual(['/v/a.md', '/v/b.md'])
  expect(firedIds(g, [])).toEqual([])
})

test('withGlow marks glowing nodes and their edges and leaves everything else as it was', () => {
  const flow = {
    nodes: [
      { id: 'a', type: 'card' as const, position: { x: 1, y: 2 }, className: 've-centre', data: { label: 'a' } },
      { id: 'b', type: 'card' as const, position: { x: 3, y: 4 }, data: { label: 'b' } },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b', className: 've-edge-link' },
      { id: 'bc', source: 'b', target: 'c' },
    ],
  }
  expect(withGlow(flow, new Set())).toBe(flow)
  const out = withGlow(flow, new Set(['a']))
  expect(out.nodes[0]).toEqual({ ...flow.nodes[0], className: 've-centre ve-glow' })
  expect(out.nodes[1]).toBe(flow.nodes[1])
  expect(out.edges[0]).toEqual({ ...flow.edges[0], className: 've-edge-link ve-edge-glow', animated: true })
  expect(out.edges[1]).toBe(flow.edges[1])
})

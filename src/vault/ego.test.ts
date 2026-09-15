import { columns, countLabel, egoFlow, firedIds, GHOST, rowsFor, toneFor, withGlow } from './ego'
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
  const flow = egoFlow(g)
  const { edges } = flow
  const nodes = flow.nodes.filter((n) => !n.id.startsWith(GHOST))
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
  const nodes = egoFlow(g).nodes.filter((n) => !n.id.startsWith(GHOST))
  const xs = new Set(nodes.slice(1).map((n) => Math.round(n.position.x)))
  const ys = new Set(nodes.slice(1).map((n) => Math.round(n.position.y)))
  expect(xs.size).toBe(5)
  expect(ys.size).toBeLessThanOrEqual(8)
  for (const n of nodes) expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true)
})

test('ghost cards frame the canvas on the centre, even when every neighbour is on its right', () => {
  const rest = Array.from({ length: 11 }, (_, i) => node(`n${i}`))
  const g: VaultGraph = { center: 'c', total: 11, error: null, nodes: [node('c'), ...rest], edges: rest.map((n) => topic(n.id, 'a')) }
  const { nodes } = egoFlow(g)
  const centre = nodes.find((n) => n.id === 'c')!.position
  const real = nodes.filter((n) => !n.id.startsWith(GHOST))
  expect(real.every((n) => n.position.x >= centre.x)).toBe(true)
  const ghosts = nodes.filter((n) => n.id.startsWith(GHOST))
  expect(ghosts.length).toBeGreaterThan(0)
  for (const n of ghosts) expect([n.className, n.selectable, n.draggable]).toEqual(['ve-ghost', false, false])
  // Every card's box, ghosts included, is centred on the centre card on both axes.
  const xs = nodes.map((n) => n.position.x)
  const ys = nodes.map((n) => n.position.y)
  expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(2 * centre.x)
  expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(2 * centre.y)
  expect(egoFlow({ ...g, nodes: [node('c')], edges: [] }).nodes.map((n) => n.id)).toEqual(['c'])
})

test('the count says how many are shown, and of how many only when the limit cut some', () => {
  const g = (shown: number, total: number): VaultGraph => ({ center: 'c', total, error: null, nodes: Array.from({ length: shown + 1 }, (_, i) => node(`n${i}`)), edges: [] })
  expect(countLabel(g(11, 37))).toBe('11 de 37')
  expect(countLabel(g(11, 11))).toBe('11 vizinhos')
  // Hub-only pages fill the room but are not in `total`.
  expect(countLabel(g(11, 4))).toBe('11 vizinhos')
  expect(countLabel({ ...g(0, 0), nodes: [] })).toBe('0 vizinhos')
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

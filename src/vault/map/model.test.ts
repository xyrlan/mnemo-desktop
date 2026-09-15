import { agentsOf, applyMap, buildGraph, edgeKey, firedIds, hash01, MAX_SIZE, MIN_SIZE, mix, needsLayout, positionsOf, readPalette, sizeFor, slugIndex, toneOf, withAlpha } from './model'
import type { MapEdge, MapNode, VaultMap } from './types'

const palette = readPalette(() => '')

const node = (path: string, over: Partial<MapNode> = {}): MapNode => ({
  path,
  slug: path.replace(/^\/|\.md$/g, ''),
  name: path.replace(/^\/|\.md$/g, ''),
  confidence: 'verified',
  heat: 1,
  type: 'feedback',
  agent: 'shared',
  fires: 3,
  ghost: false,
  ...over,
})
const link = (source: string, target: string): MapEdge => ({ source, target, kind: 'link' })
const topic = (source: string, target: string): MapEdge => ({ source, target, kind: 'topic' })
const map = (nodes: MapNode[], edges: MapEdge[] = []): VaultMap => ({ nodes, edges, error: null })

test('the palette reads the theme and falls back per variable', () => {
  const vars: Record<string, string> = { '--ansi-green': ' #0f0 ', '--accent': 'rgb(1, 2, 3)', '--bg': '#101010' }
  const p = readPalette((n) => vars[n] ?? '')
  expect(p.ok).toBe('#00ff00')
  expect(p.accent).toBe('#7aa2f7')
  expect(p.bg).toBe('#101010')
})

test('colours mix and take an alpha sigma reads', () => {
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  expect(mix('#102030', '#ffffff', -1)).toBe('#102030')
  expect(withAlpha('#abcdef', 0.5)).toBe('#abcdef80')
  expect(withAlpha('#abcdefff', 0)).toBe('#abcdef00')
})

test('tone is confidence, grey when never fired; size grows with heat and stops', () => {
  expect(toneOf(node('/a.md'))).toBe('ok')
  expect(toneOf(node('/a.md', { fires: 0 }))).toBe('muted')
  expect(toneOf(node('/a.md', { confidence: 'demoted' }))).toBe('bad')
  expect(toneOf(node('/_inbox/a.md', { fires: 0, ghost: true, confidence: 'verified' }))).toBe('ok')
  expect(sizeFor(0)).toBe(MIN_SIZE)
  expect(sizeFor(4)).toBeGreaterThan(sizeFor(1))
  expect(sizeFor(10_000)).toBe(MAX_SIZE)
})

test('saved positions are kept; a new node lands beside its linked neighbour, not its topic one', () => {
  const m = map([node('/a.md'), node('/b.md'), node('/far.md'), node('/new.md')], [link('/new.md', '/a.md'), topic('/new.md', '/far.md'), link('/a.md', '/b.md')])
  const { graph, missing } = buildGraph(m, { '/a.md': [0, 0], '/b.md': [100, 0], '/far.md': [1000, 1000] }, palette)
  expect(missing).toBe(1)
  expect(graph.getNodeAttributes('/b.md')).toMatchObject({ x: 100, y: 0 })
  const { x, y } = graph.getNodeAttributes('/new.md')
  expect(Math.hypot(x, y)).toBeLessThan(Math.hypot(x - 1000, y - 1000))
  expect(Math.hypot(x, y)).toBeGreaterThan(0)
  // The same page lands in the same spot every time.
  const again = buildGraph(m, { '/a.md': [0, 0], '/b.md': [100, 0], '/far.md': [1000, 1000] }, palette).graph
  expect(again.getNodeAttributes('/new.md')).toMatchObject({ x, y })
  expect(graph.getNodeAttributes('/a.md')).toMatchObject({ color: palette.ok, type: 'circle', label: 'a' })
})

test('a chain of new pages grows out from the placed one; loners fall inside the placed area', () => {
  const m = map([node('/a.md'), node('/b.md'), node('/c.md'), node('/d.md'), node('/lone.md')], [link('/a.md', '/b.md'), link('/c.md', '/d.md'), link('/b.md', '/c.md')])
  const { graph } = buildGraph(m, { '/a.md': [0, 0], '/d.md': [10, 10] }, palette)
  for (const id of graph.nodes()) {
    const { x, y } = graph.getNodeAttributes(id)
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
  }
  const lone = graph.getNodeAttributes('/lone.md')
  expect(lone.x).toBeGreaterThanOrEqual(0)
  expect(lone.x).toBeLessThanOrEqual(10)
})

test('a map with nothing saved gets a layout; one with a few new pages does not', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => node(`/${i}.md`))
  const none = buildGraph(map(nodes), {}, palette)
  expect(needsLayout(none.graph.order, none.missing)).toBe(true)
  const some = buildGraph(map(nodes), Object.fromEntries(nodes.slice(0, 8).map((n, i) => [n.path, [i, i]])), palette)
  expect(needsLayout(some.graph.order, some.missing)).toBe(false)
  expect(needsLayout(1, 1)).toBe(false)
  expect(Object.keys(positionsOf(none.graph))).toHaveLength(10)
})

test('edges skip self loops, unknown ends and a second edge between the same pair', () => {
  const m = map([node('/a.md'), node('/b.md')], [link('/a.md', '/b.md'), topic('/b.md', '/a.md'), link('/a.md', '/a.md'), link('/a.md', '/gone.md')])
  const { graph } = buildGraph(m, {}, palette)
  expect(graph.edges()).toEqual([edgeKey(link('/a.md', '/b.md'))])
  expect(graph.getEdgeAttributes(graph.edges()[0])).toMatchObject({ kind: 'link', size: 1 })
})

test('applying a new map adds, removes and recolours in place, keeping every position', () => {
  const before = map([node('/a.md'), node('/b.md'), node('/c.md')], [link('/a.md', '/b.md'), topic('/b.md', '/c.md')])
  const { graph } = buildGraph(before, { '/a.md': [0, 0], '/b.md': [50, 0], '/c.md': [0, 50] }, palette)
  const after = map([node('/a.md', { confidence: 'demoted' }), node('/b.md'), node('/born.md', { agent: 'repo' }), node('/_inbox/b.md', { ghost: true, slug: 'b', heat: 0 })], [link('/a.md', '/b.md'), link('/born.md', '/b.md'), { source: '/_inbox/b.md', target: '/b.md', kind: 'rewrite' }])
  const d = applyMap(graph, after, palette)
  expect(d.removed).toEqual(['/c.md'])
  expect(d.added).toEqual(['/born.md', '/_inbox/b.md'])
  expect(d.recoloured).toEqual([{ id: '/a.md', from: palette.ok, to: palette.bad }])
  expect(d.edgesAdded).toHaveLength(2)
  expect(graph.getNodeAttributes('/a.md')).toMatchObject({ x: 0, y: 0, color: palette.bad })
  expect(graph.getNodeAttributes('/_inbox/b.md')).toMatchObject({ type: 'ghost', ghost: true })
  const born = graph.getNodeAttributes('/born.md')
  expect(Math.hypot(born.x - 50, born.y)).toBeLessThan(60)
  expect(graph.hasEdge(edgeKey(topic('/b.md', '/c.md')))).toBe(false)
  expect(applyMap(graph, after, palette)).toEqual({ added: [], removed: [], recoloured: [], edgesAdded: [] })
})

test('slugs and names name nodes; ghosts never fire', () => {
  const { graph } = buildGraph(map([node('/a.md', { name: 'Rule A' }), node('/x/a.md', { slug: 'a' }), node('/_inbox/a.md', { slug: 'a', ghost: true })]), {}, palette)
  const index = slugIndex(graph)
  expect(firedIds(index, ['a']).sort()).toEqual(['/a.md', '/x/a.md'])
  expect(firedIds(index, ['Rule A', 'Rule A', 'nothing'])).toEqual(['/a.md'])
  expect(firedIds(index, [])).toEqual([])
})

test('agents of a map, shared first', () => {
  expect(agentsOf(map([node('/1', { agent: 'z' }), node('/2', { agent: 'shared' }), node('/3', { agent: 'a' }), node('/4', { agent: 'z' })]))).toEqual(['shared', 'a', 'z'])
})

test('hash01 is stable and spread', () => {
  expect(hash01('x')).toBe(hash01('x'))
  expect(hash01('x', 1)).not.toBe(hash01('x', 2))
  const values = Array.from({ length: 200 }, (_, i) => hash01(`/p/${i}.md`))
  expect(Math.min(...values)).toBeLessThan(0.1)
  expect(Math.max(...values)).toBeGreaterThan(0.9)
})

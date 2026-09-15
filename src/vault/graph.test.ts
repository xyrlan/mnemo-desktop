import { firedIds, heat, hubTopic, scopeOptions, toFlow, toneFor, withGlow } from './graph'
import type { Agent, GraphNode, PageInfo, VaultGraph } from './types'

const rule = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: '/v/shared/feedback/a.md',
  kind: 'rule',
  label: 'a',
  slug: 'a',
  type: 'feedback',
  confidence: 'verified',
  topics: [],
  fires: 3,
  last_fired: Date.UTC(2026, 8, 14),
  ...over,
})

test('colour is confidence, grey when never fired', () => {
  expect(toneFor(rule())).toBe('ok')
  expect(toneFor(rule({ confidence: 'verified-elsewhere' }))).toBe('accent')
  expect(toneFor(rule({ confidence: 'Verified CI' }))).toBe('accent')
  expect(toneFor(rule({ confidence: 'ci' }))).toBe('accent')
  expect(toneFor(rule({ confidence: 'inferred' }))).toBe('muted')
  expect(toneFor(rule({ confidence: 'demoted' }))).toBe('bad')
  expect(toneFor(rule({ confidence: null }))).toBe('warn')
  expect(toneFor(rule({ confidence: 'observed' }))).toBe('warn')
  expect(toneFor(rule({ fires: 0 }))).toBe('muted')
  expect(toneFor(rule({ kind: 'topic', fires: 0 }))).toBe('accent')
})

test('heat is 0 for never fired and grows on a log scale to 3', () => {
  expect(heat(0, 100)).toBe(0)
  expect(heat(1, 1)).toBe(3)
  expect(heat(100, 100)).toBe(3)
  expect(heat(10, 100)).toBe(2)
  expect(heat(1, 100)).toBe(1)
})

test('toFlow makes cards with badges, heat classes and topic hubs, all positioned', () => {
  const g: VaultGraph = {
    scope: 'agent:shared',
    total: 3,
    error: null,
    nodes: [
      rule(),
      rule({ id: '/v/b.md', label: 'b', slug: 'b', fires: 0, last_fired: null, confidence: null }),
      { ...rule({ id: 'topic:testing', kind: 'topic', label: '#testing', slug: '', type: '', confidence: null, fires: 2, last_fired: null }) },
    ],
    edges: [
      { id: 'link:b->a', source: '/v/b.md', target: '/v/shared/feedback/a.md', kind: 'link' },
      { id: 'topic:a->testing', source: '/v/shared/feedback/a.md', target: 'topic:testing', kind: 'topic' },
    ],
  }
  const { nodes, edges } = toFlow(g)
  expect(nodes.map((n) => [n.id, n.type, n.className, n.data.badge, n.data.tone, n.data.sub])).toEqual([
    ['/v/shared/feedback/a.md', 'card', 'vg-heat-3', '3×', 'ok', 'feedback · verified · last 2026-09-14'],
    ['/v/b.md', 'card', 'vg-heat-0', undefined, 'muted', 'feedback · no confidence · never fired'],
    ['topic:testing', 'card', 'vg-topic', undefined, 'accent', '2 rules'],
  ])
  for (const n of nodes) expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true)
  expect(edges.map((e) => [e.id, e.className])).toEqual([
    ['link:b->a', 'vg-edge-link'],
    ['topic:a->testing', 'vg-edge-topic'],
  ])
  expect(hubTopic('topic:testing')).toBe('testing')
  expect(hubTopic('/v/b.md')).toBeNull()
})

test('scope options are live agents, then topics by page count with noise left out', () => {
  const p = (topics: string[]): PageInfo => ({ path: '/x', slug: 'x', name: 'x', description: '', type: 'feedback', confidence: null, topics, modified: null, body: '' })
  const tree: Agent[] = [
    { name: 'shared', kind: 'shared', dir: '/v/shared', groups: [{ type: 'feedback', pages: [p(['Testing', 'build']), p(['testing', 'testing '])] }] },
    { name: 'mnemo-desktop', kind: 'repo', dir: '/v/bots/m', groups: [{ type: 'project', pages: [p(['build', 'rust'])] }] },
    { name: 'bg-pytest', kind: 'other', dir: '/v/bots/bg', groups: [{ type: 'user', pages: [p(['noise', 'noise'])] }] },
  ]
  expect(scopeOptions(tree)).toEqual({
    agents: ['shared', 'mnemo-desktop'],
    topics: [
      { name: 'build', count: 2 },
      { name: 'testing', count: 2 },
      { name: 'rust', count: 1 },
    ],
  })
  expect(scopeOptions(tree, 1).topics).toHaveLength(1)
})

test('firedIds finds the rule nodes a pulse names, by slug or name; hubs never', () => {
  const g: VaultGraph = {
    scope: 'agent:shared',
    total: 2,
    error: null,
    nodes: [rule(), rule({ id: '/v/b.md', slug: 'b', label: 'Rule B' }), rule({ id: 'topic:a', kind: 'topic', slug: '', label: 'a' })],
    edges: [],
  }
  expect(firedIds(g, ['a', 'Rule B', 'nope'])).toEqual(['/v/shared/feedback/a.md', '/v/b.md'])
  expect(firedIds(g, [])).toEqual([])
})

test('withGlow marks glowing nodes and their edges and leaves everything else as it was', () => {
  const flow = {
    nodes: [
      { id: 'a', type: 'card' as const, position: { x: 1, y: 2 }, className: 'vg-heat-2', data: { label: 'a' } },
      { id: 'b', type: 'card' as const, position: { x: 3, y: 4 }, data: { label: 'b' } },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b', className: 'vg-edge-link' },
      { id: 'bc', source: 'b', target: 'c' },
    ],
  }
  expect(withGlow(flow, new Set())).toBe(flow)
  const out = withGlow(flow, new Set(['a']))
  expect(out.nodes[0]).toEqual({ ...flow.nodes[0], className: 'vg-heat-2 vg-glow' })
  expect(out.nodes[1]).toBe(flow.nodes[1])
  expect(out.edges[0]).toEqual({ ...flow.edges[0], className: 'vg-edge-link vg-edge-glow', animated: true })
  expect(out.edges[1]).toBe(flow.edges[1])
  expect(withGlow(flow, new Set(['b'])).nodes[1].className).toBe('vg-glow')
})

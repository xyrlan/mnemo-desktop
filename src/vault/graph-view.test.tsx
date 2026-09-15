import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Agent, Health, Page, RunResult, VaultGraph } from './types'

const calls: [string, Record<string, unknown> | undefined][] = []
const dir = '/v/shared/feedback'
const pageInfo = (slug: string, name = slug) => ({
  path: `${dir}/${slug}.md`,
  slug,
  name,
  description: '',
  type: 'feedback',
  confidence: 'verified',
  topics: ['testing'],
  modified: null,
  body: 'body',
})
const tree: Agent[] = [{ name: 'shared', kind: 'shared', dir, groups: [{ type: 'feedback', pages: [pageInfo('run-tests', 'Run the tests'), pageInfo('bare')] }] }]
const node = (slug: string, label: string, fires: number) => ({
  id: `${dir}/${slug}.md`,
  kind: 'rule' as const,
  label,
  slug,
  type: 'feedback',
  confidence: 'verified',
  topics: ['testing'],
  fires,
  last_fired: fires ? Date.UTC(2026, 8, 14) : null,
})
const graphFor = (scope: string): VaultGraph => ({
  scope,
  total: 2,
  error: null,
  nodes: [node('run-tests', 'Run the tests', 3), node('bare', 'bare', 0), { ...node('x', '#testing', 2), id: 'topic:testing', kind: 'topic', slug: '' }],
  edges: [
    { id: 'l', source: `${dir}/bare.md`, target: `${dir}/run-tests.md`, kind: 'link' },
    { id: 't1', source: `${dir}/bare.md`, target: 'topic:testing', kind: 'topic' },
  ],
})
const ran = (stdout: string, code: number | null = 0): RunResult => ({ stdout, stderr: '', code })
const health: Health = {
  root: '/v',
  status: ran('Vault: /v  (exists)'),
  doctor: ran('', 2),
  tiles: [{ key: 'reflex', label: 'reflex injected', value: '5.0%', detail: '117 of 2350 prompts', tone: 'muted' }],
  label_only: [{ path: `${dir}/bare.md`, slug: 'bare', name: 'bare', reason: 'verified without evidence' }],
  dormant: [],
  pages: 2,
  never_fired: 1,
  inbox: 3,
  error: null,
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'vault_tree') return tree
    if (cmd === 'vault_graph') return graphFor(args!.scope as string)
    if (cmd === 'vault_health') return health
    if (cmd === 'vault_run') return ran(JSON.stringify([{ slug: 'run-tests', reason: 'cites a deleted file' }]))
    if (cmd === 'vault_page') {
      const p = tree[0].groups[0].pages.find((x) => x.path === args!.path)!
      return { ...p, runtime: null, frontmatter: [], error: null } satisfies Page
    }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// React Flow needs layout jsdom has not got; the canvas is `src/graph`'s to test.
vi.mock('../graph', () => ({
  Graph: ({ nodes, onNodeClick }: { nodes: { id: string; className?: string; data: { label: string; badge?: string; tone?: string } }[]; onNodeClick?: (id: string) => void }) => (
    <div className="stub-graph">
      {nodes.map((n) => (
        <button key={n.id} className={`stub-node ${n.className} tone-${n.data.tone}`} onClick={() => onNodeClick?.(n.id)}>
          {n.data.label}
          {n.data.badge ? ` ${n.data.badge}` : ''}
        </button>
      ))}
    </div>
  ),
}))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const byText = (root: HTMLElement, sel: string, text: string) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text)

test('graph mode shows the agent graph with health beside it; hubs change scope, rules open the page', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const { all } = await import('../actions/registry')
  expect(all().some((a) => a.id === 'vault.graph')).toBe(true)
  const Pane = paneView('vault')!

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  expect(calls.some(([c]) => c === 'vault_graph')).toBe(false)

  await click(byText(host, '.vt-modes button', 'Graph'))
  await flush()
  // No terminal: no current repo, so the graph opens on `shared`.
  expect(calls.filter(([c]) => c === 'vault_graph')).toEqual([['vault_graph', { scope: 'agent:shared' }]])
  expect([...host.querySelectorAll('.stub-node')].map((b) => [b.textContent, b.className])).toEqual([
    ['Run the tests 3×', 'stub-node vg-heat-3 tone-ok'],
    ['bare', 'stub-node vg-heat-0 tone-muted'],
    ['#testing', 'stub-node vg-topic tone-accent'],
  ])
  expect(host.querySelector('.vg-bar')?.textContent).toContain('2 rules · 1 links')
  expect((host.querySelector('.vg-bar select') as HTMLSelectElement).value).toBe('agent:shared')

  // Health: tiles, stale run in home (no cwd), label-only list, doctor's failure flagged.
  expect(calls.filter(([c]) => c === 'vault_run')).toEqual([['vault_run', { action: 'stale', args: ['--json'], cwd: '' }]])
  expect([...host.querySelectorAll('.vh-tile')].map((t) => t.textContent)).toEqual(['5.0%reflex injected', '3inbox', '1/2never fired'])
  expect([...host.querySelectorAll('.vh-row')].map((r) => r.textContent)).toEqual(['Run the testscites a deleted file', 'bareverified without evidence'])
  expect(byText(host, '.vh-text summary', 'mnemo doctor exit 2')).toBeTruthy()

  await click(byText(host, '.stub-node', '#testing'))
  await flush()
  expect(calls.filter(([c]) => c === 'vault_graph').pop()).toEqual(['vault_graph', { scope: 'topic:testing' }])
  expect((host.querySelector('.vg-bar select') as HTMLSelectElement).value).toBe('topic:testing')

  await click(byText(host, '.stub-node', 'Run the tests 3×'))
  await flush()
  expect(calls.filter(([c]) => c === 'vault_page').pop()).toEqual(['vault_page', { path: `${dir}/run-tests.md` }])
  expect(host.querySelector('.vg-side .vt-title')?.textContent).toBe('Run the tests')

  // Back to health, then a review row opens its page too.
  await click(byText(host, '.vg-tabs button', 'Health'))
  await click(byText(host, '.vh-row', 'bareverified without evidence'))
  await flush()
  expect(host.querySelector('.vg-side .vt-title')?.textContent).toBe('bare')

  await click(byText(host, '.vt-modes button', 'Pages'))
  expect(host.querySelector('.stub-graph')).toBeNull()
  expect(host.querySelector('.vt-tree')).toBeTruthy()

  await act(async () => root.unmount())
})

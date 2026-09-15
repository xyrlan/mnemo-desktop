import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Health, Page, RuleRow, RunResult, VaultGraph } from './types'

const calls: [string, Record<string, unknown> | undefined][] = []
const dir = '/v/shared/feedback'
const row = (slug: string, over: Partial<RuleRow> = {}): RuleRow => ({
  path: `${dir}/${slug}.md`,
  slug,
  name: slug,
  description: `about ${slug}`,
  type: 'feedback',
  agent: 'shared',
  confidence: 'verified',
  topics: ['testing'],
  fires: 3,
  last_fired: Date.now() - 2 * 86400_000,
  heat: 2.5,
  badges: [],
  reasons: [],
  ...over,
})
const rules: RuleRow[] = [
  row('run-tests', { name: 'Run the tests', badges: ['inbox'] }),
  row('target-dir', { type: 'project', agent: 'mnemo-desktop', confidence: 'observed', topics: ['build'], heat: 0.4, fires: 1 }),
  row('bare', { confidence: 'verified', fires: 0, heat: 0, last_fired: null, badges: ['never', 'review'], reasons: ['verified without evidence'] }),
]
const node = (slug: string, label = slug) => ({ id: `${dir}/${slug}.md`, label, slug, type: 'feedback', confidence: 'verified', topics: ['testing'], fires: 2, last_fired: null })
const egoOf = (center: string): VaultGraph => {
  const slug = center.split('/').pop()!.replace('.md', '')
  const other = slug === 'run-tests' ? 'bare' : 'run-tests'
  return {
    center,
    total: 3,
    error: null,
    nodes: [node(slug), node(other)],
    edges: [{ id: 'l', source: `${dir}/${other}.md`, target: center, kind: 'link', label: '' }],
  }
}
const ran = (stdout: string, code: number | null = 0): RunResult => ({ stdout, stderr: '', code })
const health: Health = {
  root: '/v',
  status: ran('Vault: /v  (exists)'),
  doctor: ran('doctor says hi', 2),
  tiles: [{ key: 'reflex', label: 'reflex injected', value: '5.0%', detail: '117 of 2350 prompts', tone: 'muted' }],
  label_only: [{ path: `${dir}/bare.md`, slug: 'bare', name: 'bare', reason: 'verified without evidence' }],
  dormant: [{ path: `${dir}/bare.md`, slug: 'bare', name: 'bare', reason: 'has activates_on, never fired' }],
  pages: 3,
  never_fired: 1,
  inbox: 1,
  error: null,
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'vault_rules') return args!.filter === 'nothing' ? [] : args!.scope === 'agent:mnemo-desktop' ? rules.filter((r) => r.agent === 'mnemo-desktop') : rules
    if (cmd === 'vault_ego') return egoOf(args!.path as string)
    if (cmd === 'vault_health') return health
    if (cmd === 'vault_run' && args!.action === 'stale') return ran(JSON.stringify([{ slug: 'mnemo-desktop__target-dir', reason: 'cites a deleted file' }]))
    if (cmd === 'vault_run') return ran('ok')
    if (cmd === 'vault_page') {
      const r = rules.find((x) => x.path === args!.path)!
      return { ...r, modified: null, body: 'body', runtime: null, frontmatter: [], error: null } satisfies Page
    }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
// React Flow needs layout jsdom has not got; the canvas is `src/graph`'s to test.
vi.mock('../graph', async (actual) => ({
  ...(await actual<typeof import('../graph')>()),
  Graph: ({ nodes, onNodeClick }: { nodes: { id: string; className?: string; data: { label: string; sub?: string } }[]; onNodeClick?: (id: string) => void }) => (
    <div className="stub-graph">
      {nodes.map((n) => (
        <button key={n.id} className={`stub-node ${n.className ?? ''}`.trim()} onClick={() => onNodeClick?.(n.id)}>
          {n.data.label}
        </button>
      ))}
    </div>
  ),
}))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const byText = (root: HTMLElement, sel: string, text: string) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text)
const names = (host: HTMLElement) => [...host.querySelectorAll('.vr-name-main')].map((e) => e.textContent)

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const Pane = paneView('vault')!
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  return { host, root }
}

test('the health screen is a table of rules by heat with badges, tiles, filters and row actions', async () => {
  const { host, root } = await mount()
  expect(calls.filter(([c]) => c === 'vault_rules')).toEqual([['vault_rules', { scope: '', filter: '' }]])
  expect(calls.filter(([c]) => c === 'vault_run')).toEqual([['vault_run', { action: 'stale', args: ['--json'], cwd: '' }]])

  // Rows in the order Rust sent (hottest first), stale added from `mnemo stale`.
  expect(names(host)).toEqual(['Run the tests', 'target-dir', 'bare'])
  expect([...host.querySelectorAll('.vr-row')].map((r) => [...r.querySelectorAll('.vr-badge')].map((b) => b.textContent))).toEqual([['inbox'], ['stale'], ['nunca', 'revisar']])
  expect(host.querySelector('.vr-row:nth-child(3) .vr-last')?.textContent).toBe('—')
  expect(host.querySelector('.vr-row .vr-last')?.textContent).toBe('2d ago')

  // Tiles: status numbers, then review = bare (both lists, once) + stale target-dir.
  expect([...host.querySelectorAll('.vr-strip .vh-tile')].map((t) => t.textContent)).toEqual(['5.0%reflex injected', '2precisa revisão'])
  expect(host.querySelector('.vr-raw')).toBeNull()
  await click(byText(host, 'button', 'status / doctor'))
  expect(host.querySelector('.vr-raw')?.textContent).toContain('doctor says hi')
  expect(host.querySelector('.vr-raw')?.textContent).toContain('exit 2')

  // Chips narrow the rows on this side; a second click clears.
  await click(byText(host, '.vr-chip', 'project 1'))
  expect(names(host)).toEqual(['target-dir'])
  expect(host.querySelector('.vr-bar')?.textContent).toContain('1 of 3 rules')
  await click(byText(host, '.vr-chip', 'project 1'))
  await click(byText(host, '.vr-chip', '#testing 2'))
  expect(names(host)).toEqual(['Run the tests', 'bare'])
  await click(byText(host, '.vr-chip', '#testing 2'))
  // "precisa revisão" turns on "só problemas": every badged row.
  await click(host.querySelector('.vr-review'))
  expect((host.querySelector('.vr-toggle input') as HTMLInputElement).checked).toBe(true)
  expect(names(host)).toEqual(['Run the tests', 'target-dir', 'bare'])
  await act(async () => (host.querySelector('.vr-toggle input') as HTMLInputElement).click())

  // Scope re-reads; the filter re-reads once typing pauses.
  const select = host.querySelector('.vr-bar select') as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['', 'agent:shared', 'agent:mnemo-desktop'])
  await act(async () => {
    select.value = 'agent:mnemo-desktop'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect(names(host)).toEqual(['target-dir'])
  const input = host.querySelector('.vr-bar input') as HTMLInputElement
  vi.useFakeTimers()
  for (const q of ['no', 'nothing'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, q)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  expect(calls.filter(([c]) => c === 'vault_rules')).toHaveLength(2)
  await act(async () => vi.advanceTimersByTime(250))
  vi.useRealTimers()
  await flush()
  expect(calls.filter(([c]) => c === 'vault_rules').slice(2)).toEqual([['vault_rules', { scope: 'agent:mnemo-desktop', filter: 'nothing' }]])
  expect(host.querySelector('.vr-table')?.textContent).toBe('No rule matches.')

  await act(async () => root.unmount())
})

test('a row opens its page and ego graph; a neighbour selects; disable asks twice', async () => {
  const { vault } = await import('./app-store')
  vault.setState({ scope: '', filter: '', rulesLoaded: false })
  const { host, root } = await mount()
  // No side panel until a rule is selected: the table keeps the whole width.
  expect(host.querySelector('.vr-side')).toBeNull()
  expect(host.querySelector('.stub-graph')).toBeNull()

  await click(byText(host, '.vr-name-main', 'Run the tests')!.closest('tr'))
  await flush()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('Run the tests')
  expect(calls.filter(([c]) => c === 'vault_ego').pop()).toEqual(['vault_ego', { path: `${dir}/run-tests.md`, limit: 12 }])
  expect([...host.querySelectorAll('.stub-node')].map((b) => [b.textContent, b.className])).toEqual([
    ['run-tests', 'stub-node ve-centre'],
    ['bare', 'stub-node'],
  ])
  expect(host.querySelector('.ve-bar')?.textContent).toContain('1 of 3 neighbours')
  expect(host.querySelector('.vr-selected .vr-name-main')?.textContent).toBe('Run the tests')

  await click(byText(host, '.stub-node', 'bare'))
  await flush()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('bare')
  expect(host.querySelector('.vr-selected .vr-name-main')?.textContent).toBe('bare')
  expect(host.querySelector('.stub-node.ve-centre')?.textContent).toBe('bare')

  const disable = () => host.querySelector('.vr-row:nth-child(2) .vr-acts .vt-destructive')!
  await click(disable())
  expect(calls.some(([c, a]) => c === 'vault_run' && a?.action === 'disable-rule')).toBe(false)
  expect(disable().textContent).toBe('really?')
  await click(disable())
  await flush()
  expect(calls.filter(([c, a]) => c === 'vault_run' && a?.action === 'disable-rule')).toEqual([['vault_run', { action: 'disable-rule', args: ['target-dir'], cwd: '' }]])
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('target-dir')
  expect(host.querySelector('.vt-log')?.textContent).toContain('$ mnemo disable-rule target-dir')

  await act(async () => root.unmount())
})

test('a pulse naming a rule on the ego graph makes its node glow for GLOW_MS', async () => {
  const { GLOW_MS } = await import('./EgoView')
  const { pulseStore } = await import('../pulse/app-store')
  const { vault } = await import('./app-store')
  // Fired before the graph was shown: not replayed.
  pulseStore.getState().push({ at: 1, kind: 'reflex', project: 'p', agent: 'p', slugs: ['run-tests'] })
  await vault.getState().select(`${dir}/bare.md`)
  const { host, root } = await mount()
  await flush()
  const cls = (label: string) => byText(host, '.stub-node', label)!.className
  expect(host.querySelectorAll('.ve-glow')).toHaveLength(0)

  vi.useFakeTimers()
  await act(async () => pulseStore.getState().push({ at: 2, kind: 'tool', project: 'p', agent: 'p', slugs: ['run-tests', 'elsewhere'], tool: 'read_mnemo_rule' }))
  expect(cls('run-tests')).toBe('stub-node ve-glow')
  expect(cls('bare')).not.toContain('ve-glow')
  await act(async () => vi.advanceTimersByTime(GLOW_MS / 2))
  await act(async () => pulseStore.getState().push({ at: 3, kind: 'enrich', project: 'p', agent: 'p', slugs: ['bare'] }))
  await act(async () => vi.advanceTimersByTime(GLOW_MS / 2 + 1))
  expect(cls('run-tests')).not.toContain('ve-glow')
  expect(cls('bare')).toContain('ve-glow')
  await act(async () => vi.advanceTimersByTime(GLOW_MS))
  expect(host.querySelectorAll('.ve-glow')).toHaveLength(0)
  vi.useRealTimers()
  await act(async () => root.unmount())
})

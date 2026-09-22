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
  tiles: [{ key: 'reflex', label: 'reflex injected', value: '5.0%', detail: '117 of 2350 prompts', tone: 'muted' }],
  label_only: [{ path: `${dir}/bare.md`, slug: 'bare', name: 'bare', reason: 'verified without evidence' }],
  dormant: [{ path: `${dir}/bare.md`, slug: 'bare', name: 'bare', reason: 'has activates_on, never fired' }],
  pages: 3,
  never_fired: 1,
  inbox: 1,
  error: null,
}

// A test sets these to hold `vault_health` open, or to make it or `vault_ego` fail.
let healthGate: Promise<void> | null = null
let healthError: string | null = null
let egoError: string | null = null

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'vault_rules') return args!.filter === 'nothing' ? [] : args!.scope === 'agent:mnemo-desktop' ? rules.filter((r) => r.agent === 'mnemo-desktop') : rules
    if (cmd === 'vault_ego') return { ...egoOf(args!.path as string), error: egoError }
    if (cmd === 'vault_health') return (await healthGate, { ...health, error: healthError })
    if (cmd === 'vault_doctor') return ran('doctor says hi', 2)
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
  expect([...host.querySelectorAll('.vr-row')].map((r) => [...r.querySelectorAll('.vr-badge')].map((b) => b.textContent))).toEqual([['inbox'], ['stale'], ['never', 'review']])
  expect(host.querySelector('.vr-row:nth-child(3) .vr-last')?.textContent).toBe('—')
  expect(host.querySelector('.vr-row .vr-last')?.textContent).toBe('2d ago')

  // Tiles: status numbers, then review = bare (both lists, once) + stale target-dir, then inbox.
  expect([...host.querySelectorAll('.vr-strip .vh-tile')].map((t) => t.textContent)).toEqual(['5.0%reflex injected', '2needs review', '1inbox'])
  expect(host.querySelector('.vr-raw')).toBeNull()
  // `doctor` is 4.8s against a real vault, so the health read does not run it.
  expect(calls.some(([c]) => c === 'vault_doctor')).toBe(false)
  await click(byText(host, 'button', 'status / doctor'))
  await flush()
  expect(calls.some(([c]) => c === 'vault_doctor')).toBe(true)
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

const tab = (host: HTMLElement, label: string) => byText(host, '.vr-side [role="tab"]', label)
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

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
  await click(tab(host, 'Neighbourhood'))
  await flush()
  expect(calls.filter(([c]) => c === 'vault_ego').pop()).toEqual(['vault_ego', { path: `${dir}/run-tests.md`, limit: 12 }])
  expect([...host.querySelectorAll('.stub-node:not(.ve-ghost)')].map((b) => [b.textContent, b.className])).toEqual([
    ['run-tests', 'stub-node ve-centre'],
    ['bare', 'stub-node'],
  ])
  expect(host.querySelector('.ve-bar')?.textContent).toContain('1 of 3')
  // A ghost card only frames the canvas: clicking one selects nothing.
  await click(host.querySelector('.stub-node.ve-ghost'))
  await flush()
  expect(host.querySelector('.stub-node.ve-centre')?.textContent).toBe('run-tests')
  expect(host.querySelector('.vr-selected .vr-name-main')?.textContent).toBe('Run the tests')

  // A neighbour's click keeps the graph open, now centred on the neighbour.
  await click(byText(host, '.stub-node', 'bare'))
  await flush()
  expect(host.querySelector('.vr-selected .vr-name-main')?.textContent).toBe('bare')
  expect(host.querySelector('.stub-node.ve-centre')?.textContent).toBe('bare')
  await click(tab(host, 'Page'))
  expect(host.querySelector('.stub-graph')).toBeNull()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('bare')

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
  await click(tab(host, 'Neighbourhood'))
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

test('the side panel opens on Page, runs vault_ego only when Neighbourhood is asked for, and closes with ×', async () => {
  const { vault } = await import('./app-store')
  vault.setState({ selected: null, page: null, ego: null })
  const { host, root } = await mount()
  const egoCalls = () => calls.filter(([c]) => c === 'vault_ego').length
  const before = egoCalls()

  await click(byText(host, '.vr-name-main', 'target-dir')!.closest('tr'))
  await flush()
  expect([...host.querySelectorAll('.vr-side [role="tab"]')].map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
    ['Page', 'true'],
    ['Neighbourhood', 'false'],
  ])
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('target-dir')
  expect(host.querySelector('.vr-side .ve')).toBeNull()
  // Clicking through rows reads pages, never the graph.
  await click(byText(host, '.vr-name-main', 'bare')!.closest('tr'))
  await flush()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('bare')
  expect(egoCalls()).toBe(before)

  await click(tab(host, 'Neighbourhood'))
  await flush()
  expect(egoCalls()).toBe(before + 1)
  expect(host.querySelector('.stub-node.ve-centre')?.textContent).toBe('bare')

  await click(host.querySelector('.vr-side-close'))
  expect(host.querySelector('.vr-side')).toBeNull()
  expect(host.querySelector('.vr-with-side')).toBeNull()
  expect(host.querySelector('.vr-selected')).toBeNull()
  expect(vault.getState().selected).toBeNull()

  // Reopened, the panel starts on Page again.
  await click(byText(host, '.vr-name-main', 'target-dir')!.closest('tr'))
  await flush()
  expect(tab(host, 'Page')?.getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('.vr-side .ve')).toBeNull()
  await act(async () => root.unmount())
})

test('Esc closes the side panel from the table, but not from the filter box', async () => {
  const { vault } = await import('./app-store')
  vault.setState({ selected: null, page: null, filter: '' })
  const { host, root } = await mount()
  await click(byText(host, '.vr-name-main', 'target-dir')!.closest('tr'))
  await flush()
  expect(host.querySelector('.vr-side')).not.toBeNull()

  // In the filter box Esc clears the text and leaves the panel alone.
  const input = host.querySelector('.vr-bar input') as HTMLInputElement
  await key(input, 'Escape')
  expect(host.querySelector('.vr-side')).not.toBeNull()

  // A modified Esc is somebody else's chord.
  await act(() => void host.querySelector('.vr-name-main')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', metaKey: true, bubbles: true })))
  expect(host.querySelector('.vr-side')).not.toBeNull()

  // From a row, or from inside the panel, it closes.
  await key(host.querySelector('.vr-name-main')!, 'Escape')
  expect(host.querySelector('.vr-side')).toBeNull()
  expect(vault.getState().selected).toBeNull()
  await click(byText(host, '.vr-name-main', 'bare')!.closest('tr'))
  await flush()
  await key(tab(host, 'Page')!, 'Escape')
  expect(host.querySelector('.vr-side')).toBeNull()

  // With nothing open Esc is let through to whoever is listening above the table.
  let reached = false
  const above = () => (reached = true)
  document.addEventListener('keydown', above)
  await key(host.querySelector('.vr-name-main')!, 'Escape')
  expect(reached).toBe(true)
  document.removeEventListener('keydown', above)
  await act(async () => root.unmount())
})

test('the health strip shows a loading state, never a blank, while the first read runs', async () => {
  const { vault } = await import('./app-store')
  vault.setState({ health: null, healthLoading: false })
  let open!: () => void
  healthGate = new Promise((r) => (open = r))
  const { host, root } = await mount()
  const status = host.querySelector('.vr-strip .vt-loading')
  expect(status?.getAttribute('role')).toBe('status')
  expect(status?.textContent).toBe('running mnemo status, stale…')
  healthGate = null
  open()
  await flush()
  expect(host.querySelector('.vr-strip .vt-loading')).toBeNull()
  expect(host.querySelector('.vr-strip .vh-tile')).not.toBeNull()
  await act(async () => root.unmount())
})

test('a health error and a neighbourhood error can each be dismissed, and come back on the next read', async () => {
  const { vault } = await import('./app-store')
  vault.setState({ health: null, selected: null, page: null, ego: null })
  healthError = 'mnemo: not found'
  egoError = 'vault_ego: boom'
  try {
    const { host, root } = await mount()
    const healthErr = () => host.querySelector('.vr .vt-error-line')
    expect(healthErr()?.textContent).toContain('mnemo: not found')
    await click(healthErr()!.querySelector('button'))
    expect(healthErr()).toBeNull()
    await click(byText(host, '.vr-strip button', '↻'))
    await flush()
    expect(healthErr()?.textContent).toContain('mnemo: not found')
    await click(healthErr()!.querySelector('button'))

    await click(byText(host, '.vr-name-main', 'bare')!.closest('tr'))
    await flush()
    await click(tab(host, 'Neighbourhood'))
    await flush()
    const egoErr = () => host.querySelector('.ve .vt-error-line')
    expect(egoErr()?.textContent).toContain('vault_ego: boom')
    await click(egoErr()!.querySelector('button'))
    expect(egoErr()).toBeNull()
    await click(tab(host, 'Page'))
    await click(byText(host, '.vr-name-main', 'target-dir')!.closest('tr'))
    await flush()
    await click(tab(host, 'Neighbourhood'))
    await flush()
    expect(egoErr()?.textContent).toContain('vault_ego: boom')
    await act(async () => root.unmount())
  } finally {
    healthError = null
    egoError = null
  }
})

test('the inbox tile on the health strip opens the inbox pane', async () => {
  const { vault } = await import('./app-store')
  const { host, root } = await mount()
  const tile = byText(host, '.vh-tile-label', 'inbox')?.closest('button')
  expect(tile?.textContent).toBe('1inbox')
  await click(tile)
  await flush()
  expect(host.querySelector('.ib')).not.toBeNull()
  expect(host.querySelector('.vr-strip')).toBeNull()
  expect(calls.some(([c, a]) => c === 'vault_run' && (a as { action: string }).action === 'inbox')).toBe(true)
  vault.getState().setMode('health')
  await act(async () => root.unmount())
})

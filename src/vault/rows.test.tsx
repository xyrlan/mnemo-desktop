import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Health, Page, RuleRow, RunResult, VaultGraph } from './types'

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
const rules: RuleRow[] = [row('first', { name: 'First rule' }), row('second', { name: 'Second rule' }), row('third', { name: 'Third rule' })]
const ran = (stdout: string, code: number | null = 0): RunResult => ({ stdout, stderr: '', code })
const health: Health = {
  root: '/v',
  status: ran('Vault: /v  (exists)'),
  tiles: [],
  label_only: [],
  dormant: [],
  pages: 3,
  never_fired: 0,
  inbox: 0,
  error: null,
}
const ego = (center: string): VaultGraph => ({ center, total: 1, error: null, nodes: [], edges: [] })

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'vault_rules') return rules
    if (cmd === 'vault_ego') return ego(args!.path as string)
    if (cmd === 'vault_health') return health
    if (cmd === 'vault_doctor') return ran('ok')
    if (cmd === 'vault_run' && args!.action === 'stale') return ran('[]')
    if (cmd === 'vault_run') return ran('ok')
    if (cmd === 'vault_page') {
      const r = rules.find((x) => x.path === args!.path)!
      return { ...r, modified: null, body: 'body', runtime: null, frontmatter: [], error: null } satisfies Page
    }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../graph', async (actual) => ({
  ...(await actual<typeof import('../graph')>()),
  Graph: () => <div className="stub-graph" />,
}))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
const selectedName = (host: HTMLElement) => host.querySelector('.vr-selected .vr-name-main')?.textContent ?? null
const rowFor = (host: HTMLElement, name: string) => [...host.querySelectorAll('.vr-row')].find((r) => r.querySelector('.vr-name-main')?.textContent === name)!

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  await import('./view')
  const { vault } = await import('./app-store')
  vault.setState({ selected: null, page: null, ego: null, filter: '', chips: { type: null, topic: null, problems: false } })
  const { paneView } = await import('../panes/registry')
  const Pane = paneView('vault')!
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  return { host, root }
}

test('a row is reachable by Tab and opens on Enter', async () => {
  const { host, root } = await mount()
  const first = rowFor(host, 'First rule')
  // A <tr> is not focusable on its own: without tabIndex, Tab walks past the whole table.
  expect(first.getAttribute('tabindex')).toBe('0')
  expect(first.getAttribute('aria-selected')).toBe('false')

  await key(first, 'Enter')
  await flush()
  expect(selectedName(host)).toBe('First rule')
  expect(rowFor(host, 'First rule').getAttribute('aria-selected')).toBe('true')
  await act(async () => root.unmount())
})

test('the arrows walk the table with focus on a row, not only in the filter box', async () => {
  const { host, root } = await mount()
  const table = host.querySelector('.vr')!
  await key(rowFor(host, 'First rule'), 'Enter')
  await flush()

  await key(table, 'ArrowDown')
  await flush()
  expect(selectedName(host)).toBe('Second rule')

  await key(table, 'ArrowDown')
  await flush()
  expect(selectedName(host)).toBe('Third rule')

  // The last row is the floor: ArrowDown past it stays put rather than clearing the selection.
  await key(table, 'ArrowDown')
  await flush()
  expect(selectedName(host)).toBe('Third rule')

  await key(table, 'ArrowUp')
  await flush()
  expect(selectedName(host)).toBe('Second rule')
  await act(async () => root.unmount())
})

test('Escape still closes the side panel, and the arrows do not fight the filter box', async () => {
  const { host, root } = await mount()
  await key(rowFor(host, 'Second rule'), 'Enter')
  await flush()
  expect(host.querySelector('.vr-side')).not.toBeNull()

  await key(host.querySelector('.vr')!, 'Escape')
  await flush()
  expect(host.querySelector('.vr-side')).toBeNull()
  expect(selectedName(host)).toBeNull()

  // `listKey` refuses events from an input, so the filter box keeps its own arrow handling
  // and the root's handler never sees them.
  const input = host.querySelector('.vr-bar input') as HTMLInputElement
  await key(input, 'ArrowDown')
  await flush()
  expect(selectedName(host)).toBe('First rule')
  await act(async () => root.unmount())
})

test('a row’s Edit opens the page in the editor without selecting the row', async () => {
  const { host, root } = await mount()
  const { store } = await import('../layout/app-store')
  const openView = vi.spyOn(store.getState(), 'openView').mockImplementation(() => {})
  try {
    await act(async () => (rowFor(host, 'Second rule').querySelector('.vr-acts button[aria-label="Edit"]') as HTMLElement).click())
    await flush()
    expect(openView).toHaveBeenCalledWith('editor', { path: `${dir}/second.md` }, 'auto', 'second.md')
    // The toolbar floats inside the row: its clicks must not reach the row's own.
    expect(selectedName(host)).toBeNull()
    expect(host.querySelector('.vr-side')).toBeNull()
  } finally {
    openView.mockRestore()
    await act(async () => root.unmount())
  }
})

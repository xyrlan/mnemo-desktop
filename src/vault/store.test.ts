import vaultRs from '../../src-tauri/src/vault.rs?raw'
import libRs from '../../src-tauri/src/lib.rs?raw'
import { createVaultStore, escapeTarget, MAX_LOG } from './store'
import { makeVaultClient, type VaultClient } from './client'
import { ACTIONS } from './actions'
import type { Agent, Health, Page, PageInfo, RuleRow, RunResult, VaultGraph } from './types'

const info = (slug: string): PageInfo => ({
  path: `/v/shared/feedback/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'feedback',
  confidence: null,
  topics: [],
  modified: null,
  body: 'body',
})
const tree = (): Agent[] => [{ name: 'shared', kind: 'shared', dir: '/v/shared', groups: [{ type: 'feedback', pages: [info('a'), info('b')] }] }]
const page = (p: PageInfo): Page => ({ ...p, runtime: null, frontmatter: [], error: null })
const ok = (stdout = 'done'): RunResult => ({ stdout, stderr: '', code: 0 })
const egoOf = (center: string): VaultGraph => ({ center, nodes: [], edges: [], total: 0, error: null })
const row = (slug: string, agent = 'shared'): RuleRow => ({
  path: `/v/shared/feedback/${slug}.md`,
  slug,
  name: slug,
  description: '',
  type: 'feedback',
  agent,
  confidence: null,
  topics: [],
  fires: 0,
  last_fired: null,
  heat: 0,
  badges: [],
  reasons: [],
})
const health = (over: Partial<Health> = {}): Health => ({
  root: '/v',
  status: ok('Vault: /v'),
  doctor: ok('all good'),
  tiles: [],
  label_only: [],
  dormant: [],
  pages: 2,
  never_fired: 1,
  inbox: 0,
  error: null,
  ...over,
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

function fake(over: Partial<VaultClient> = {}): VaultClient {
  return {
    tree: async () => tree(),
    page: async (path) => page(tree()[0].groups[0].pages.find((p) => p.path === path)!),
    run: async () => ok(),
    rules: async () => [row('a'), row('b')],
    ego: async (path) => egoOf(path),
    health: async () => health(),
    ...over,
  }
}

test('load reads the tree once at a time and re-reads the selected page', async () => {
  let trees = 0
  const pages: string[] = []
  const s = createVaultStore(fake({ tree: async () => (trees++, tree()), page: async (p) => (pages.push(p), page(info('a'))) }))
  await Promise.all([s.getState().load(), s.getState().load()])
  expect(trees).toBe(1)
  expect(s.getState().loaded).toBe(true)
  await s.getState().select('/v/shared/feedback/a.md')
  await s.getState().load()
  expect(pages).toEqual(['/v/shared/feedback/a.md', '/v/shared/feedback/a.md'])
})

test('a failing tree read is an error, not a crash', async () => {
  const s = createVaultStore(fake({ tree: async () => Promise.reject('boom') }))
  await s.getState().load()
  expect(s.getState()).toMatchObject({ loaded: true, loading: false, treeError: 'boom', tree: [] })
})

test('the last click wins over a slow page read', async () => {
  const slow = deferred<Page>()
  const s = createVaultStore(fake({ page: (p) => (p.endsWith('a.md') ? slow.promise : Promise.resolve(page(info('b')))) }))
  await s.getState().load()
  const first = s.getState().select('/v/shared/feedback/a.md')
  await s.getState().select('/v/shared/feedback/b.md')
  slow.resolve(page(info('a')))
  await first
  expect(s.getState().page?.slug).toBe('b')
})

test('a page read that throws shows the error on the page', async () => {
  const s = createVaultStore(fake({ page: async () => Promise.reject('gone') }))
  await s.getState().load()
  await s.getState().select('/v/shared/feedback/a.md')
  expect(s.getState().page).toMatchObject({ slug: 'a', error: 'gone' })
})

test('running an action logs it, passes the slug and cwd, and ignores a double click', async () => {
  const d = deferred<RunResult>()
  const calls: [string, string[], string][] = []
  const s = createVaultStore(fake({ run: (a, args, cwd) => (calls.push([a, args, cwd]), d.promise) }))
  await s.getState().load()
  await s.getState().select('/v/shared/feedback/b.md')
  const run = s.getState().run('why', '/repo')
  expect(s.getState().running('why')).toBe(true)
  void s.getState().run('why', '/repo')
  d.resolve(ok('[]'))
  await run
  expect(calls).toEqual([['why', ['--json', '--limit', '50'], '/repo']])
  expect(s.getState().log).toEqual([
    { id: 1, actionId: 'why', line: 'mnemo why --json --limit 50', cwd: '/repo', slug: 'b', result: ok('[]') },
  ])
  expect(s.getState().running('why')).toBe(false)
})

test('disable needs a page, passes its slug, and reloads the tree when it succeeds', async () => {
  let trees = 0
  const calls: string[][] = []
  const s = createVaultStore(fake({ tree: async () => (trees++, tree()), run: async (a, args) => (calls.push([a, ...args]), ok()) }))
  await s.getState().load()
  await s.getState().run('disable', '/repo')
  expect(calls).toEqual([])
  await s.getState().select('/v/shared/feedback/a.md')
  await s.getState().run('disable', '/repo')
  expect(calls).toEqual([['disable-rule', 'a']])
  expect(trees).toBe(2)
})

test('a failed or rejected run is logged and does not reload', async () => {
  let trees = 0
  const s = createVaultStore(fake({ tree: async () => (trees++, tree()), run: async () => Promise.reject('no mnemo') }))
  await s.getState().load()
  await s.getState().run('learn', '')
  expect(s.getState().log[0].result).toEqual({ stdout: '', stderr: 'no mnemo', code: null })
  expect(trees).toBe(1)
  await s.getState().run('unknown-action', '')
  expect(s.getState().log).toHaveLength(1)
  s.getState().dismiss(s.getState().log[0].id)
  expect(s.getState().log).toEqual([])
})

test('the log keeps the last entries only', async () => {
  const s = createVaultStore(fake())
  for (let i = 0; i < MAX_LOG + 3; i++) await s.getState().run('status', '')
  expect(s.getState().log).toHaveLength(MAX_LOG)
  expect(s.getState().log[0].id).toBe(4)
})

test('the table reads scope and filter, the latest read wins, and agents accumulate', async () => {
  const slow = deferred<RuleRow[]>()
  const asked: [string, string][] = []
  const s = createVaultStore(
    fake({ rules: (scope, filter) => (asked.push([scope, filter]), scope === '' ? slow.promise : Promise.resolve([row('x', 'mnemo-desktop')])) }),
  )
  expect(s.getState()).toMatchObject({ mode: 'health', scope: '', filter: '', rules: [], rulesLoaded: false })
  s.getState().setFilter('cargo')
  const first = s.getState().loadRules()
  await s.getState().setScope('agent:mnemo-desktop')
  slow.resolve([row('a'), row('b')])
  await first
  expect(asked).toEqual([
    ['', 'cargo'],
    ['agent:mnemo-desktop', 'cargo'],
  ])
  expect(s.getState()).toMatchObject({ rulesLoaded: true, rulesLoading: false, agents: ['mnemo-desktop'] })
  expect(s.getState().rules.map((r) => r.slug)).toEqual(['x'])
  await s.getState().setScope('')
  expect(s.getState().agents).toEqual(['mnemo-desktop', 'shared'])

  s.getState().setChips({ problems: true })
  s.getState().setChips({ type: 'feedback' })
  expect(s.getState().chips).toEqual({ type: 'feedback', topic: null, problems: true })

  const broken = createVaultStore(fake({ rules: async () => Promise.reject('no vault') }))
  await broken.getState().loadRules()
  expect(broken.getState()).toMatchObject({ rules: [], rulesLoaded: true, rulesLoading: false })
})

test('a row the tree never read can be disabled, and a success re-reads the table only', async () => {
  let trees = 0
  let tables = 0
  const calls: string[][] = []
  const s = createVaultStore(
    fake({ tree: async () => (trees++, tree()), rules: async () => (tables++, [row('only-in-table')]), run: async (a, args) => (calls.push([a, ...args]), ok()) }),
  )
  await s.getState().loadRules()
  await s.getState().select('/v/shared/feedback/only-in-table.md')
  await s.getState().run('disable', '/repo')
  expect(calls).toEqual([['disable-rule', 'only-in-table']])
  expect([trees, tables]).toEqual([0, 2])
})

test('the latest ego read wins over a slow one, and a failing read is an error graph', async () => {
  const slow = deferred<VaultGraph>()
  const s = createVaultStore(fake({ ego: (path, limit) => (expect(limit).toBe(12), path === '/a.md' ? slow.promise : Promise.resolve(egoOf(path))) }))
  const first = s.getState().loadEgo('/a.md')
  expect(s.getState()).toMatchObject({ egoLoading: true, ego: null })
  await s.getState().loadEgo('/b.md')
  slow.resolve(egoOf('/a.md'))
  await first
  expect(s.getState()).toMatchObject({ egoLoading: false, ego: { center: '/b.md' } })

  const broken = createVaultStore(fake({ ego: async () => Promise.reject('no vault') }))
  await broken.getState().loadEgo('/x.md')
  expect(broken.getState().ego).toEqual({ center: '/x.md', nodes: [], edges: [], total: 0, error: 'no vault' })
})

test('health reads vault_health and runs stale --json in the cwd, once at a time', async () => {
  const runs: [string, string[], string][] = []
  let reads = 0
  const s = createVaultStore(fake({ health: async () => (reads++, health()), run: async (a, args, cwd) => (runs.push([a, args, cwd]), ok('[]')) }))
  expect(s.getState().mode).toBe('health')
  s.getState().setMode('pages')
  await Promise.all([s.getState().loadHealth('/repo'), s.getState().loadHealth('/repo')])
  expect(reads).toBe(1)
  expect(runs).toEqual([['stale', ['--json'], '/repo']])
  expect(s.getState()).toMatchObject({ mode: 'pages', healthLoading: false, health: { never_fired: 1 }, stale: ok('[]') })

  const broken = createVaultStore(fake({ health: async () => Promise.reject('boom'), run: async () => Promise.reject('no mnemo') }))
  await broken.getState().loadHealth('')
  expect(broken.getState().health).toMatchObject({ error: 'boom', tiles: [], label_only: [] })
  expect(broken.getState().stale).toEqual({ stdout: '', stderr: 'no mnemo', code: null })
})

test('client maps to the Tauri commands', async () => {
  const seen: [string, unknown][] = []
  const c = makeVaultClient(async <T,>(cmd: string, args?: Record<string, unknown>) => (seen.push([cmd, args]), undefined as T))
  await c.tree()
  await c.page('/v/x.md')
  await c.run('status', [], '/repo')
  await c.rules('agent:shared', 'cargo')
  await c.ego('/v/x.md', 12)
  await c.health()
  expect(seen).toEqual([
    ['vault_tree', undefined],
    ['vault_page', { path: '/v/x.md' }],
    ['vault_run', { action: 'status', args: [], cwd: '/repo' }],
    ['vault_rules', { scope: 'agent:shared', filter: 'cargo' }],
    ['vault_ego', { path: '/v/x.md', limit: 12 }],
    ['vault_health', undefined],
  ])
})

test('every button runs a subcommand the Rust allowlist has, and the allowlist holds only those and stale', () => {
  const allow = /pub const ACTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(vaultRs)![1].match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1))
  // `stale` has no button: the health panel runs it (`loadHealth`).
  expect(new Set([...ACTIONS.map((a) => a.command), 'stale'])).toEqual(new Set(allow))
  expect(ACTIONS.filter((a) => a.destructive).map((a) => a.id)).toEqual(['disable', 'rewrites-apply'])
})

test('graph, the old name of the health screen, opens health', () => {
  const s = createVaultStore(fake())
  s.getState().setMode('pages')
  s.getState().setMode('graph')
  expect(s.getState().mode).toBe('health')
})

test('every command the client invokes is registered in the vault block of lib.rs', () => {
  const block = /\/\/ -- vault commands --([^/]*)/.exec(libRs)![1]
  const registered = [...block.matchAll(/vault::(\w+)/g)].map((m) => m[1])
  const invoked: string[] = []
  const c = makeVaultClient(async <T,>(cmd: string) => (invoked.push(cmd), undefined as T))
  void Promise.all([c.tree(), c.page(''), c.run('', [], ''), c.rules('', ''), c.ego('', 1), c.health()])
  expect(registered.sort()).toEqual(invoked.sort())
  for (const cmd of invoked) expect(vaultRs).toContain(`pub async fn ${cmd}(`)
})

test('deselect closes the page and its ego graph, and a slow read lands nowhere', async () => {
  const pageRead = deferred<Page>()
  const egoRead = deferred<VaultGraph>()
  const s = createVaultStore(fake({ page: () => pageRead.promise, ego: () => egoRead.promise }))
  const path = '/v/shared/feedback/a.md'
  const selecting = s.getState().select(path)
  const ego = s.getState().loadEgo(path)
  s.getState().deselect()
  pageRead.resolve(page(info('a')))
  egoRead.resolve(egoOf(path))
  await Promise.all([selecting, ego])
  expect(s.getState()).toMatchObject({ selected: null, page: null, ego: null, egoLoading: false })
})

test('deselect drops a page and ego graph already read', async () => {
  const s = createVaultStore(fake())
  const path = '/v/shared/feedback/a.md'
  await s.getState().select(path)
  await s.getState().loadEgo(path)
  expect(s.getState().page?.path).toBe(path)
  s.getState().deselect()
  expect(s.getState()).toMatchObject({ selected: null, page: null, ego: null })
})

test('escapeTarget closes the innermost thing first', () => {
  const none = { armed: false, selected: null, filter: '', query: '' }
  expect(escapeTarget(none)).toBeNull()
  expect(escapeTarget({ ...none, query: 'q' })).toBe('clear-query')
  expect(escapeTarget({ ...none, query: 'q', filter: 'f' })).toBe('clear-filter')
  expect(escapeTarget({ ...none, query: 'q', filter: 'f', selected: '/p.md' })).toBe('deselect')
  expect(escapeTarget({ armed: true, query: 'q', filter: 'f', selected: '/p.md' })).toBe('disarm')
  // An empty path is still a selection.
  expect(escapeTarget({ ...none, selected: '' })).toBe('deselect')
})

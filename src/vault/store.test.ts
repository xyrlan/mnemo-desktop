import vaultRs from '../../src-tauri/src/vault.rs?raw'
import { createVaultStore, MAX_LOG } from './store'
import { makeVaultClient, type VaultClient } from './client'
import { ACTIONS } from './actions'
import type { Agent, Page, PageInfo, RunResult } from './types'

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

test('client maps to the three Tauri commands', async () => {
  const seen: [string, unknown][] = []
  const c = makeVaultClient(async <T,>(cmd: string, args?: Record<string, unknown>) => (seen.push([cmd, args]), undefined as T))
  await c.tree()
  await c.page('/v/x.md')
  await c.run('status', [], '/repo')
  expect(seen).toEqual([
    ['vault_tree', undefined],
    ['vault_page', { path: '/v/x.md' }],
    ['vault_run', { action: 'status', args: [], cwd: '/repo' }],
  ])
})

test('every button runs a subcommand the Rust allowlist has, and only those six exist', () => {
  const allow = /pub const ACTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(vaultRs)![1].match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1))
  expect(new Set(ACTIONS.map((a) => a.command))).toEqual(new Set(allow))
  expect(ACTIONS.filter((a) => a.destructive).map((a) => a.id)).toEqual(['disable', 'rewrites-apply'])
})

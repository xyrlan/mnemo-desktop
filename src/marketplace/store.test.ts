import { createMarketplaceStore, ALL } from './store'
import { makeMarketplaceClient, type MarketplaceClient } from './client'
import type { RuleSet } from './types'

const set = (over: Partial<RuleSet> = {}): RuleSet => ({
  source: 'https://x/rules',
  name: 'rules',
  path: '/c/abc/.mnemo-shared',
  description: '',
  rule_count: 2,
  types: { feedback: 2 },
  topics: [],
  projects: [],
  last_commit: null,
  error: null,
  ...over,
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fake(over: Partial<MarketplaceClient> = {}): MarketplaceClient {
  return {
    list: async () => [set()],
    refresh: async () => [set()],
    addSource: async () => {},
    removeSource: async () => {},
    importSet: async () => 'import: 2 staged',
    ...over,
  }
}

test('load lists once and marks loaded', async () => {
  let calls = 0
  const s = createMarketplaceStore(fake({ list: async () => (calls++, [set()]) }))
  await Promise.all([s.getState().load(), s.getState().load()])
  expect(calls).toBe(1)
  expect(s.getState().loaded).toBe(true)
  expect(s.getState().sets).toHaveLength(1)
})

test('import card goes idle → importing → ok with the command output', async () => {
  const d = deferred<string>()
  const seen: [string, string][] = []
  const s = createMarketplaceStore(fake({ importSet: (p, c) => (seen.push([p, c]), d.promise) }))
  const run = s.getState().importSet('/c/abc/.mnemo-shared', '/proj')
  expect(s.getState().cards['/c/abc/.mnemo-shared']).toEqual({ status: 'importing', cwd: '/proj' })
  // A double click while importing does not run mnemo twice.
  void s.getState().importSet('/c/abc/.mnemo-shared', '/proj')
  d.resolve('import: 2 staged')
  await run
  expect(seen).toEqual([['/c/abc/.mnemo-shared', '/proj']])
  expect(s.getState().cards['/c/abc/.mnemo-shared']).toEqual({ status: 'ok', cwd: '/proj', output: 'import: 2 staged' })
  s.getState().dismiss('/c/abc/.mnemo-shared')
  expect(s.getState().cards['/c/abc/.mnemo-shared']).toEqual({ status: 'idle' })
})

test('import failure puts the error output on that card only', async () => {
  const s = createMarketplaceStore(fake({ importSet: async (p) => (p === '/a' ? Promise.reject('refused feedback/x') : 'ok') }))
  await Promise.all([s.getState().importSet('/a', '/proj'), s.getState().importSet('/b', '/proj')])
  expect(s.getState().cards['/a']).toEqual({ status: 'error', cwd: '/proj', output: 'refused feedback/x' })
  expect(s.getState().cards['/b']).toMatchObject({ status: 'ok' })
})

test('refresh tracks a spinner per source and one for all', async () => {
  const d = deferred<RuleSet[]>()
  const urls: (string | undefined)[] = []
  const s = createMarketplaceStore(fake({ refresh: (u) => (urls.push(u), d.promise) }))
  const one = s.getState().refresh('https://x/rules')
  void s.getState().refresh('https://x/rules')
  expect(s.getState().refreshing).toEqual({ 'https://x/rules': true })
  d.resolve([set({ rule_count: 5 })])
  await one
  expect(urls).toEqual(['https://x/rules'])
  expect(s.getState().refreshing['https://x/rules']).toBe(false)
  expect(s.getState().sets[0].rule_count).toBe(5)
  const all = s.getState().refresh()
  expect(s.getState().refreshing[ALL]).toBe(true)
  await all
  expect(urls).toEqual(['https://x/rules', undefined])
})

test('a failing list keeps the previous sets and records the error', async () => {
  const c = fake()
  const s = createMarketplaceStore(c)
  await s.getState().load()
  c.refresh = async () => Promise.reject('git missing')
  await s.getState().refresh()
  expect(s.getState().sets).toHaveLength(1)
  expect(s.getState().listError).toBe('git missing')
  expect(s.getState().refreshing[ALL]).toBe(false)
})

test('addSource returns the validation error, or fetches the new source', async () => {
  const refreshed: (string | undefined)[] = []
  const s = createMarketplaceStore(
    fake({
      addSource: async (u) => (u.startsWith('-') ? Promise.reject('not a git URL: -x') : undefined),
      refresh: async (u) => (refreshed.push(u), [set(), set({ source: u!, path: '/c/new/.mnemo-shared' })]),
    }),
  )
  expect(await s.getState().addSource('-x')).toBe('not a git URL: -x')
  expect(refreshed).toEqual([])
  expect(await s.getState().addSource('  https://y/more  ')).toBeNull()
  expect(refreshed).toEqual(['https://y/more'])
  expect(s.getState().sets).toHaveLength(2)
})

test('client sends the argument names the Rust commands take', async () => {
  const calls: [string, unknown][] = []
  const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) => (calls.push([cmd, args]), undefined as T)
  const c = makeMarketplaceClient(invoke)
  await c.list()
  await c.refresh()
  await c.refresh('u')
  await c.addSource('u')
  await c.removeSource('u')
  await c.importSet('/t', '/p')
  expect(calls).toEqual([
    ['marketplace_list', undefined],
    ['marketplace_refresh', { url: null }],
    ['marketplace_refresh', { url: 'u' }],
    ['marketplace_add_source', { url: 'u' }],
    ['marketplace_remove_source', { url: 'u' }],
    ['marketplace_import', { path: '/t', cwd: '/p' }],
  ])
})

import { createMarketplaceStore, ALL, newKey } from './store'
import { makeMarketplaceClient, type MarketplaceClient } from './client'
import type { RepoRules, RuleSet } from './types'

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

const repo = (over: Partial<RepoRules> = {}): RepoRules => ({
  root: '/w/app',
  name: 'app',
  set: set({ source: '/w/app', path: '/w/app/.mnemo-shared' }),
  rules: [{ slug: 'a', page_type: 'feedback', description: '', rel: 'feedback/a.md', standing: 'new' }],
  vault: '/v',
  default_branch: 'main',
  branch: 'main',
  uncommitted: false,
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
    repo: async () => repo(),
    publish: async () => ({ output: 'published 1 rule', uncommitted: true }),
    openPr: async () => ({ branch: 'team-rules/2026-09-15', base: 'main', url: 'https://pr/7', output: '$ gh pr create' }),
    importNew: async () => 'staged 1',
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
  await c.repo('/p/src')
  await c.publish('/p')
  await c.openPr('/p', '2026-09-15')
  await c.importNew('/p/src')
  expect(calls).toEqual([
    ['marketplace_list', undefined],
    ['marketplace_refresh', { url: null }],
    ['marketplace_refresh', { url: 'u' }],
    ['marketplace_add_source', { url: 'u' }],
    ['marketplace_remove_source', { url: 'u' }],
    ['marketplace_import', { path: '/t', cwd: '/p' }],
    ['marketplace_repo', { cwd: '/p/src' }],
    ['marketplace_publish', { root: '/p' }],
    ['marketplace_open_pr', { root: '/p', date: '2026-09-15' }],
    ['marketplace_import_new', { cwd: '/p/src' }],
  ])
})

test('the repo section follows the cwd, and drops an answer for a cwd no longer focused', async () => {
  const pending: Record<string, ReturnType<typeof deferred<RepoRules>>> = {}
  const s = createMarketplaceStore(fake({ repo: (cwd) => (pending[cwd] = deferred<RepoRules>()).promise }))
  const first = s.getState().loadRepo('/w/app')
  const second = s.getState().loadRepo('/w/other')
  pending['/w/other'].resolve(repo({ root: '/w/other', name: 'other' }))
  await second
  pending['/w/app'].resolve(repo())
  await first
  expect(s.getState().repo?.name).toBe('other')
  expect(s.getState().repoLoading).toBe(false)
  await s.getState().loadRepo(undefined)
  expect(s.getState().repo).toBeNull()
})

test('a failing repo read shows as the section error', async () => {
  const s = createMarketplaceStore(fake({ repo: async () => Promise.reject('git: not found') }))
  await s.getState().loadRepo('/w/app')
  expect(s.getState().repo).toMatchObject({ error: 'git: not found', rules: [] })
})

test('publish shows the output, Open PR runs only after confirming, and the repo is read again after each', async () => {
  const reads: string[] = []
  const prs: [string, string][] = []
  const s = createMarketplaceStore(
    fake({
      repo: async (cwd) => (reads.push(cwd), repo({ uncommitted: true })),
      openPr: async (root, date) => (prs.push([root, date]), { branch: 'team-rules/2026-09-15', base: 'main', url: 'https://pr/7', output: '$ gh pr create' }),
    }),
  )
  await s.getState().loadRepo('/w/app/src')
  await s.getState().publishRepo('/w/app')
  expect(s.getState().publish['/w/app']).toEqual({ status: 'published', ok: true, output: 'published 1 rule' })
  expect(reads).toEqual(['/w/app/src', '/w/app/src'])

  await s.getState().openPr('/w/app', '2026-09-15')
  expect(prs).toEqual([])
  s.getState().askOpenPr('/w/app')
  await s.getState().openPr('/w/app', '2026-09-15')
  expect(prs).toEqual([['/w/app', '2026-09-15']])
  expect(s.getState().publish['/w/app']).toEqual({ status: 'opened', ok: true, output: '$ gh pr create', url: 'https://pr/7', branch: 'team-rules/2026-09-15' })
  expect(reads).toHaveLength(3)
})

test('publish and Open PR failures carry their output', async () => {
  const s = createMarketplaceStore(
    fake({ publish: async () => Promise.reject('error: no vault'), openPr: async () => Promise.reject('$ git push\nrejected') }),
  )
  await s.getState().publishRepo('/w/app')
  expect(s.getState().publish['/w/app']).toEqual({ status: 'published', ok: false, output: 'error: no vault' })
  s.getState().dismissPublish('/w/app')
  s.getState().askOpenPr('/w/app')
  await s.getState().openPr('/w/app', '2026-09-15')
  expect(s.getState().publish['/w/app']).toMatchObject({ status: 'opened', ok: false, output: '$ git push\nrejected' })
})

test('Import all new runs once per click and puts its output on the repo, then rereads it', async () => {
  const d = deferred<string>()
  let reads = 0
  const cwds: string[] = []
  const s = createMarketplaceStore(fake({ importNew: (cwd) => (cwds.push(cwd), d.promise), repo: async () => (reads++, repo()) }))
  await s.getState().loadRepo('/w/app')
  const run = s.getState().importNew('/w/app', '/w/app')
  void s.getState().importNew('/w/app', '/w/app')
  d.resolve('staged 1')
  await run
  expect(cwds).toEqual(['/w/app'])
  expect(s.getState().cards[newKey('/w/app')]).toEqual({ status: 'ok', cwd: '/w/app', output: 'staged 1' })
  expect(reads).toBe(2)
  // Importing the repo's whole tree rereads the section too; another source's does not.
  await s.getState().importSet('/w/app/.mnemo-shared', '/w/app')
  await s.getState().importSet('/c/abc/.mnemo-shared', '/w/app')
  expect(reads).toBe(3)
})

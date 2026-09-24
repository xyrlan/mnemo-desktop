import type { SearchOpts, SearchResult } from './client'
import { createSearchStore } from './store'

type Call = { root: string; query: string; opts: SearchOpts; resolve(r: SearchResult): void; reject(e: unknown): void }

function fake() {
  const calls: Call[] = []
  const search = (root: string, query: string, opts: SearchOpts) =>
    new Promise<SearchResult>((resolve, reject) => void calls.push({ root, query, opts, resolve, reject }))
  return { calls, store: createSearchStore({ search, debounceMs: 100 }) }
}

const result = (files: string[]): SearchResult => ({
  files: files.map((f) => ({ filePath: `/r/${f}`, relativePath: f, matches: [{ line: 1, column: 1, matchLength: 1, lineContent: 'x' }] })),
  totalMatches: files.length,
  truncated: false,
  timedOut: false,
})
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => vi.useRealTimers())

describe('the search store', () => {
  it('searches once typing pauses, with the options on', async () => {
    const { calls, store } = fake()
    store.getState().setRoot('/r')
    store.getState().toggle('caseSensitive')
    store.getState().setQuery('fo')
    store.getState().setQuery('foo')
    expect(store.getState().loading).toBe(true)
    vi.advanceTimersByTime(99)
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(calls.map((c) => [c.root, c.query, c.opts])).toEqual([
      ['/r', 'foo', { caseSensitive: true, wholeWord: false, useRegex: false, include: '', exclude: '' }],
    ])
    calls[0].resolve(result(['a.ts']))
    await vi.waitFor(() => expect(store.getState().results?.totalMatches).toBe(1))
    expect(store.getState().loading).toBe(false)
  })

  it('runs at once on Enter and drops a reply to an older search', async () => {
    const { calls, store } = fake()
    store.getState().setRoot('/r')
    store.getState().setQuery('old')
    void store.getState().run()
    store.getState().setQuery('new')
    void store.getState().run()
    expect(calls.map((c) => c.query)).toEqual(['old', 'new'])
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveLength(2)
    calls[1].resolve(result(['new.ts']))
    await vi.waitFor(() => expect(store.getState().results?.files[0].relativePath).toBe('new.ts'))
    calls[0].resolve(result(['old.ts']))
    calls[0].reject('late')
    vi.useRealTimers()
    await settle()
    expect(store.getState().results?.files[0].relativePath).toBe('new.ts')
    expect(store.getState().error).toBeNull()
  })

  it('says why a search failed, and an empty query clears without searching', async () => {
    const { calls, store } = fake()
    store.getState().setRoot('/r')
    store.getState().setQuery('(')
    void store.getState().run()
    calls[0].reject('unmatched ( for expression group')
    await vi.waitFor(() => expect(store.getState().error).toBe('unmatched ( for expression group'))
    expect(store.getState().results).toBeNull()
    store.getState().clear()
    expect(store.getState()).toMatchObject({ query: '', error: null, results: null, loading: false })
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveLength(1)
  })

  it('searches the new worktree when the root changes, and nothing without one', async () => {
    const { calls, store } = fake()
    store.getState().setQuery('foo')
    vi.advanceTimersByTime(100)
    expect(calls).toHaveLength(0)
    expect(store.getState().loading).toBe(false)
    store.getState().setRoot('/a')
    store.getState().setRoot('/a')
    expect(calls.map((c) => c.root)).toEqual(['/a'])
    calls[0].resolve(result(['x']))
    await vi.waitFor(() => expect(store.getState().results).not.toBeNull())
    store.getState().setRoot('/b')
    expect(store.getState().results).toBeNull()
    expect(calls.map((c) => c.root)).toEqual(['/a', '/b'])
  })

  it('searches again when an option or a glob changes', () => {
    const { calls, store } = fake()
    store.getState().setRoot('/r')
    store.getState().setQuery('foo')
    vi.advanceTimersByTime(100)
    store.getState().toggle('useRegex')
    store.getState().toggle('wholeWord')
    store.getState().setInclude('*.ts')
    store.getState().setExclude('dist')
    vi.advanceTimersByTime(100)
    expect(calls.map((c) => c.opts)).toEqual([
      { caseSensitive: false, wholeWord: false, useRegex: false, include: '', exclude: '' },
      { caseSensitive: false, wholeWord: true, useRegex: true, include: '*.ts', exclude: 'dist' },
    ])
  })

  it('folds and unfolds a file; a new result unfolds everything', async () => {
    const { calls, store } = fake()
    store.getState().setRoot('/r')
    store.getState().setQuery('foo')
    void store.getState().run()
    calls[0].resolve(result(['a']))
    await vi.waitFor(() => expect(store.getState().results).not.toBeNull())
    store.getState().toggleCollapsed('/r/a')
    expect([...store.getState().collapsed]).toEqual(['/r/a'])
    store.getState().toggleCollapsed('/r/a')
    expect(store.getState().collapsed.size).toBe(0)
    store.getState().toggleCollapsed('/r/a')
    void store.getState().run()
    calls[1].resolve(result(['a']))
    await vi.waitFor(() => expect(store.getState().collapsed.size).toBe(0))
  })

  it('shows and hides the include and exclude fields', () => {
    const { store } = fake()
    store.getState().toggleFilters()
    expect(store.getState().showFilters).toBe(true)
    store.getState().toggleFilters()
    expect(store.getState().showFilters).toBe(false)
  })
})

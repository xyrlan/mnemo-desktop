import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SearchOpts, SearchResult } from './client'

/** How long typing pauses before the search runs; Enter runs it at once. */
export const DEBOUNCE_MS = 250

export type SearchDeps = {
  search(root: string, query: string, opts: SearchOpts): Promise<SearchResult>
  debounceMs?: number
}

export type Toggle = 'caseSensitive' | 'wholeWord' | 'useRegex'

export type SearchState = {
  /** The worktree searched; null before there is one. */
  root: string | null
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  include: string
  exclude: string
  showFilters: boolean
  /** The last search's result, for the query and options it ran with. */
  results: SearchResult | null
  /** A search is waiting out the debounce or running. */
  loading: boolean
  /** Why the last search failed: a bad regex, a root that went away. */
  error: string | null
  /** Files whose matches are folded, by `filePath`. */
  collapsed: ReadonlySet<string>
}

export type SearchActions = {
  setRoot(root: string | null): void
  setQuery(query: string): void
  toggle(which: Toggle): void
  setInclude(include: string): void
  setExclude(exclude: string): void
  toggleFilters(): void
  toggleCollapsed(filePath: string): void
  /** Runs the search now (Enter), dropping a pending debounce. */
  run(): Promise<void>
  clear(): void
}

export type SearchStore = StoreApi<SearchState & SearchActions>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createSearchStore(deps: SearchDeps): SearchStore {
  const wait = deps.debounceMs ?? DEBOUNCE_MS
  return createStore<SearchState & SearchActions>((set, get) => {
    /** Each search's number: a reply for an older one is dropped. */
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const cancel = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    async function run() {
      cancel()
      const s = get()
      const mine = ++seq
      if (!s.root || !s.query) return set({ results: null, loading: false, error: null })
      set({ loading: true })
      const opts: SearchOpts = { caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, useRegex: s.useRegex, include: s.include, exclude: s.exclude }
      try {
        const results = await deps.search(s.root, s.query, opts)
        if (mine === seq) set({ results, loading: false, error: null, collapsed: new Set() })
      } catch (e) {
        if (mine === seq) set({ results: null, loading: false, error: message(e) })
      }
    }

    /** Runs after the debounce; with nothing to search, clears at once. */
    function later() {
      cancel()
      const s = get()
      if (!s.root || !s.query) return void run()
      set({ loading: true })
      timer = setTimeout(() => void run(), wait)
    }

    return {
      root: null,
      query: '',
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      include: '',
      exclude: '',
      showFilters: false,
      results: null,
      loading: false,
      error: null,
      collapsed: new Set(),

      setRoot(root) {
        if (root === get().root) return
        set({ root, results: null, error: null })
        void run()
      },
      setQuery(query) {
        if (query === get().query) return
        set({ query })
        later()
      },
      toggle(which) {
        set({ [which]: !get()[which] } as Pick<SearchState, Toggle>)
        later()
      },
      setInclude(include) {
        set({ include })
        later()
      },
      setExclude(exclude) {
        set({ exclude })
        later()
      },
      toggleFilters: () => set({ showFilters: !get().showFilters }),
      toggleCollapsed(filePath) {
        const collapsed = new Set(get().collapsed)
        if (!collapsed.delete(filePath)) collapsed.add(filePath)
        set({ collapsed })
      },
      run,
      clear() {
        set({ query: '' })
        void run()
      },
    }
  })
}

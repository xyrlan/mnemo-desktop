import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { VaultClient } from './client'
import { actionById } from './actions'
import { EGO_LIMIT } from './ego'
import { NO_CHIPS, type Chips } from './rules'
import { findPage } from './search'
import type { Agent, Health, Page, PageInfo, RuleRow, RunResult, VaultGraph } from './types'

export type LogEntry = {
  id: number
  actionId: string
  /** `mnemo why --json …`, as shown. */
  line: string
  cwd: string
  /** The page selected when it ran (Why filters by its slug). */
  slug: string | null
  result: RunResult | null
}

/** Health (the rules table, the selected page and its ego graph) or pages (tree + page). */
export type VaultMode = 'health' | 'pages'

export type VaultState = {
  tree: Agent[]
  loaded: boolean
  loading: boolean
  treeError: string | null
  /** The pages tree's search. */
  query: string
  /** Path of the selected page, in either mode. */
  selected: string | null
  page: Page | null
  /** Agent name → expanded; unset falls back to the view's default. */
  expanded: Record<string, boolean>
  log: LogEntry[]
  mode: VaultMode
  /** The table's scope: `''` for every rule, else `agent:<name>`. */
  scope: string
  /** The table's text filter, as sent to `vault_rules`. */
  filter: string
  chips: Chips
  rules: RuleRow[]
  rulesLoaded: boolean
  rulesLoading: boolean
  /** Every agent a table read has named: the scopes to offer. */
  agents: string[]
  /** The ego graph of `selected`, once read. */
  ego: VaultGraph | null
  egoLoading: boolean
  health: Health | null
  healthLoading: boolean
  /** `mnemo stale --json`, run in the current repo beside `vault_health`. */
  stale: RunResult | null
}

export type VaultActions = {
  load(): Promise<void>
  setQuery(q: string): void
  select(path: string): Promise<void>
  toggle(agent: string, open: boolean): void
  /** Runs one of `ACTIONS` in `cwd`; resolves when it finishes. */
  run(actionId: string, cwd: string): Promise<void>
  running(actionId: string): boolean
  dismiss(id: number): void
  /** `graph` is the round-5 name of the health screen, still passed by `src/pulse/open.test.ts`. */
  setMode(mode: VaultMode | 'graph'): void
  /** Sets the scope and re-reads the table. */
  setScope(scope: string): Promise<void>
  /** Sets the filter only: the view debounces `loadRules`. */
  setFilter(filter: string): void
  setChips(chips: Partial<Chips>): void
  /** Reads the table for the current scope and filter; the latest read wins. */
  loadRules(): Promise<void>
  /** Reads the ego graph of `path`; a later path wins over a slow read. */
  loadEgo(path: string): Promise<void>
  /** Reads health and runs `mnemo stale --json` in `cwd`, once at a time. */
  loadHealth(cwd: string): Promise<void>
}

export type VaultStore = StoreApi<VaultState & VaultActions>

export const MAX_LOG = 20

/** What an action needs of a row the tree has not read. */
const rowInfo = (r: RuleRow): PageInfo => ({ path: r.path, slug: r.slug, name: r.name, description: r.description, type: r.type, confidence: r.confidence, topics: r.topics, modified: null, body: '' })

export function createVaultStore(client: VaultClient): VaultStore {
  let nextId = 1
  let rulesRead = 0
  let egoRead = 0
  return createZustand<VaultState & VaultActions>((set, get) => {
    /** The page at `path` as the tree or the table knows it. */
    const known = (path: string): PageInfo | undefined => {
      const row = get().rules.find((r) => r.path === path)
      return findPage(get().tree, path) ?? (row && rowInfo(row))
    }

    const readPage = async (path: string) => {
      let page: Page
      try {
        page = await client.page(path)
      } catch (e) {
        page = { ...(known(path) ?? blank(path)), runtime: null, frontmatter: [], error: String(e) }
      }
      // A later click wins over a slow read.
      if (get().selected === path) set({ page })
    }

    return {
      tree: [],
      loaded: false,
      loading: false,
      treeError: null,
      query: '',
      selected: null,
      page: null,
      expanded: {},
      log: [],
      mode: 'health',
      scope: '',
      filter: '',
      chips: NO_CHIPS,
      rules: [],
      rulesLoaded: false,
      rulesLoading: false,
      agents: [],
      ego: null,
      egoLoading: false,
      health: null,
      healthLoading: false,
      stale: null,

      async load() {
        if (get().loading) return
        set({ loading: true })
        try {
          set({ tree: await client.tree(), loaded: true, treeError: null })
        } catch (e) {
          set({ treeError: String(e), loaded: true })
        }
        set({ loading: false })
        const sel = get().selected
        if (sel) await readPage(sel)
      },

      setQuery(query) {
        set({ query })
      },

      async select(path) {
        set({ selected: path, page: get().page?.path === path ? get().page : null })
        await readPage(path)
      },

      toggle(agent, open) {
        set((s) => ({ expanded: { ...s.expanded, [agent]: open } }))
      },

      running(actionId) {
        return get().log.some((e) => e.actionId === actionId && e.result === null)
      },

      async run(actionId, cwd) {
        const action = actionById(actionId)
        if (!action || get().running(actionId)) return
        const page = get().selected ? known(get().selected!) ?? null : null
        if (action.needsPage && !page) return
        const args = action.args(page)
        const id = nextId++
        const entry: LogEntry = { id, actionId, line: ['mnemo', action.command, ...args].join(' '), cwd, slug: page?.slug ?? null, result: null }
        set((s) => ({ log: [...s.log, entry].slice(-MAX_LOG) }))
        let result: RunResult
        try {
          result = await client.run(action.command, args, cwd)
        } catch (e) {
          result = { stdout: '', stderr: String(e), code: null }
        }
        set((s) => ({ log: s.log.map((x) => (x.id === id ? { ...x, result } : x)) }))
        if (action.reloads && result.code === 0) {
          const s = get()
          // Only what has been read already: the tree, the table.
          await Promise.all([s.loaded ? s.load() : null, s.rulesLoaded ? s.loadRules() : null])
        }
      },

      dismiss(id) {
        set((s) => ({ log: s.log.filter((x) => x.id !== id) }))
      },

      setMode(mode) {
        set({ mode: mode === 'graph' ? 'health' : mode })
      },

      async setScope(scope) {
        set({ scope })
        await get().loadRules()
      },

      setFilter(filter) {
        set({ filter })
      },

      setChips(chips) {
        set((s) => ({ chips: { ...s.chips, ...chips } }))
      },

      async loadRules() {
        const read = ++rulesRead
        const { scope, filter } = get()
        set({ rulesLoading: true })
        let rules: RuleRow[]
        try {
          rules = await client.rules(scope, filter)
        } catch {
          rules = []
        }
        if (read !== rulesRead) return
        const agents = [...new Set([...get().agents, ...rules.map((r) => r.agent)])]
        set({ rules, rulesLoaded: true, rulesLoading: false, agents: agents.length === get().agents.length ? get().agents : agents })
      },

      async loadEgo(path) {
        const read = ++egoRead
        set({ egoLoading: true, ego: get().ego?.center === path ? get().ego : null })
        let ego: VaultGraph
        try {
          ego = await client.ego(path, EGO_LIMIT)
        } catch (e) {
          ego = { center: path, nodes: [], edges: [], total: 0, error: String(e) }
        }
        if (read === egoRead) set({ ego, egoLoading: false })
      },

      async loadHealth(cwd) {
        if (get().healthLoading) return
        set({ healthLoading: true })
        const failed = (e: unknown): RunResult => ({ stdout: '', stderr: String(e), code: null })
        const [health, stale] = await Promise.all([
          client.health().catch((e): Health => ({ ...emptyHealth(), error: String(e) })),
          client.run('stale', ['--json'], cwd).catch(failed),
        ])
        set({ health, stale, healthLoading: false })
      },
    }
  })
}

function emptyHealth(): Health {
  const none: RunResult = { stdout: '', stderr: '', code: null }
  return { root: null, status: none, doctor: none, tiles: [], label_only: [], dormant: [], pages: 0, never_fired: 0, inbox: 0, error: null }
}

function blank(path: string): PageInfo {
  return { path, slug: '', name: path.split('/').pop() ?? path, description: '', type: '', confidence: null, topics: [], modified: null, body: '' }
}

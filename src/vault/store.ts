import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { VaultClient } from './client'
import { actionById } from './actions'
import { findPage } from './search'
import type { Agent, Health, Page, PageInfo, RunResult, VaultGraph } from './types'

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

export type VaultState = {
  tree: Agent[]
  loaded: boolean
  loading: boolean
  treeError: string | null
  query: string
  /** Path of the selected page. */
  selected: string | null
  page: Page | null
  /** Agent name → expanded; unset falls back to the view's default. */
  expanded: Record<string, boolean>
  log: LogEntry[]
  /** Pages (tree + page) or graph (graph + health). */
  mode: VaultMode
  /** The graph's `agent:<name>` / `topic:<name>`; null until the graph is first shown. */
  scope: string | null
  graph: VaultGraph | null
  graphLoading: boolean
  health: Health | null
  healthLoading: boolean
  /** `mnemo stale --json`, run in the current repo beside `vault_health`. */
  stale: RunResult | null
}

export type VaultMode = 'pages' | 'graph'

export type VaultActions = {
  load(): Promise<void>
  setQuery(q: string): void
  select(path: string): Promise<void>
  toggle(agent: string, open: boolean): void
  /** Runs one of `ACTIONS` in `cwd`; resolves when it finishes. */
  run(actionId: string, cwd: string): Promise<void>
  running(actionId: string): boolean
  dismiss(id: number): void
  setMode(mode: VaultMode): void
  /** Reads the graph of `scope`; a later scope wins over a slow read. */
  loadGraph(scope: string): Promise<void>
  /** Reads health and runs `mnemo stale --json` in `cwd`, once at a time. */
  loadHealth(cwd: string): Promise<void>
}

export type VaultStore = StoreApi<VaultState & VaultActions>

export const MAX_LOG = 20

export function createVaultStore(client: VaultClient): VaultStore {
  let nextId = 1
  return createZustand<VaultState & VaultActions>((set, get) => {
    const readPage = async (path: string) => {
      let page: Page
      try {
        page = await client.page(path)
      } catch (e) {
        page = { ...(findPage(get().tree, path) ?? blank(path)), runtime: null, frontmatter: [], error: String(e) }
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
      mode: 'pages',
      scope: null,
      graph: null,
      graphLoading: false,
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
        const page = get().selected ? findPage(get().tree, get().selected!) ?? null : null
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
        if (action.reloads && result.code === 0) await get().load()
      },

      dismiss(id) {
        set((s) => ({ log: s.log.filter((x) => x.id !== id) }))
      },

      setMode(mode) {
        set({ mode })
      },

      async loadGraph(scope) {
        set({ scope, graphLoading: true, graph: get().graph?.scope === scope ? get().graph : null })
        let graph: VaultGraph
        try {
          graph = await client.graph(scope)
        } catch (e) {
          graph = { scope, nodes: [], edges: [], total: 0, error: String(e) }
        }
        if (get().scope === scope) set({ graph, graphLoading: false })
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

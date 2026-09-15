import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { MarketplaceClient } from './client'
import { cardReducer, IDLE, type Card, type CardEvent } from './cards'
import { IDLE_PUBLISH, publishReducer, type Publish, type PublishEvent } from './publish'
import type { RepoRules, RuleSet } from './types'

/** Key of the refresh-every-source spinner in `refreshing`. */
export const ALL = '*'

/** Key of a repo's Import all new button in `cards`. */
export const newKey = (root: string) => `new:${root}`

export type MarketplaceState = {
  sets: RuleSet[]
  loaded: boolean
  loading: boolean
  /** Source URL (or `ALL`) → a refresh is running. */
  refreshing: Record<string, boolean>
  /** Why listing itself failed (the command, not a source). */
  listError: string | null
  /** Tree path (or `newKey(root)`) → the card's import state. */
  cards: Record<string, Card>
  /** The "this repo" section, for the cwd last asked about. */
  repo: RepoRules | null
  repoCwd: string | null
  repoLoading: boolean
  /** Working-copy root → its Publish / Open PR flow. */
  publish: Record<string, Publish>
}

export type MarketplaceActions = {
  load(): Promise<void>
  refresh(url?: string): Promise<void>
  /** Adds and fetches a source. Resolves with the error text, or null on success. */
  addSource(url: string): Promise<string | null>
  removeSource(url: string): Promise<void>
  importSet(path: string, cwd: string): Promise<void>
  dismiss(path: string): void
  /** Reads the repo holding `cwd`; with no cwd, clears the section. */
  loadRepo(cwd: string | undefined): Promise<void>
  importNew(root: string, cwd: string): Promise<void>
  publishRepo(root: string): Promise<void>
  askOpenPr(root: string): void
  cancelOpenPr(root: string): void
  openPr(root: string, date: string): Promise<void>
  dismissPublish(root: string): void
}

export type MarketplaceStore = StoreApi<MarketplaceState & MarketplaceActions>

export function createMarketplaceStore(client: MarketplaceClient): MarketplaceStore {
  return createZustand<MarketplaceState & MarketplaceActions>((set, get) => {
    const card = (path: string, e: CardEvent) =>
      set((s) => ({ cards: { ...s.cards, [path]: cardReducer(s.cards[path] ?? IDLE, e) } }))
    const flow = (root: string, e: PublishEvent) =>
      set((s) => ({ publish: { ...s.publish, [root]: publishReducer(s.publish[root] ?? IDLE_PUBLISH, e) } }))
    const reloadRepo = () => get().loadRepo(get().repoCwd ?? undefined)
    const busy = (key: string, on: boolean) => set((s) => ({ refreshing: { ...s.refreshing, [key]: on } }))
    const listed = async (run: () => Promise<RuleSet[]>) => {
      try {
        set({ sets: await run(), loaded: true, listError: null })
      } catch (e) {
        set({ listError: String(e) })
      }
    }

    return {
      sets: [],
      loaded: false,
      loading: false,
      refreshing: {},
      listError: null,
      cards: {},
      repo: null,
      repoCwd: null,
      repoLoading: false,
      publish: {},

      async load() {
        if (get().loading) return
        set({ loading: true })
        await listed(() => client.list())
        set({ loading: false })
      },

      async refresh(url) {
        const key = url ?? ALL
        if (get().refreshing[key]) return
        busy(key, true)
        await listed(() => client.refresh(url))
        busy(key, false)
      },

      async addSource(url) {
        const u = url.trim()
        try {
          await client.addSource(u)
        } catch (e) {
          return String(e)
        }
        await get().refresh(u)
        return null
      },

      async removeSource(url) {
        try {
          await client.removeSource(url)
        } catch (e) {
          set({ listError: String(e) })
          return
        }
        await listed(() => client.list())
      },

      async importSet(path, cwd) {
        if (get().cards[path]?.status === 'importing') return
        card(path, { type: 'start', cwd })
        try {
          card(path, { type: 'done', ok: true, output: await client.importSet(path, cwd) })
        } catch (e) {
          card(path, { type: 'done', ok: false, output: String(e) })
        }
        if (get().repo?.set?.path === path) await reloadRepo()
      },

      dismiss(path) {
        card(path, { type: 'dismiss' })
      },

      async loadRepo(cwd) {
        if (!cwd) {
          set({ repo: null, repoCwd: null, repoLoading: false })
          return
        }
        set((s) => ({ repoCwd: cwd, repoLoading: true, repo: s.repoCwd === cwd ? s.repo : null }))
        let repo: RepoRules
        try {
          repo = await client.repo(cwd)
        } catch (e) {
          repo = { root: '', name: '', set: null, rules: [], vault: null, default_branch: null, branch: null, uncommitted: false, error: String(e) }
        }
        // The focus moved on while git ran: that answer is for another repo.
        if (get().repoCwd === cwd) set({ repo, repoLoading: false })
      },

      async importNew(root, cwd) {
        const key = newKey(root)
        if (get().cards[key]?.status === 'importing') return
        card(key, { type: 'start', cwd })
        try {
          card(key, { type: 'done', ok: true, output: await client.importNew(cwd) })
        } catch (e) {
          card(key, { type: 'done', ok: false, output: String(e) })
        }
        await reloadRepo()
      },

      async publishRepo(root) {
        if (get().publish[root]?.status === 'publishing' || get().publish[root]?.status === 'opening') return
        flow(root, { type: 'start' })
        try {
          flow(root, { type: 'published', ok: true, output: (await client.publish(root)).output })
        } catch (e) {
          flow(root, { type: 'published', ok: false, output: String(e) })
        }
        await reloadRepo()
      },

      askOpenPr(root) {
        flow(root, { type: 'ask' })
      },

      cancelOpenPr(root) {
        flow(root, { type: 'cancel' })
      },

      async openPr(root, date) {
        if (get().publish[root]?.status !== 'confirming') return
        flow(root, { type: 'open' })
        try {
          const pr = await client.openPr(root, date)
          flow(root, { type: 'opened', ok: true, output: pr.output, url: pr.url, branch: pr.branch })
        } catch (e) {
          flow(root, { type: 'opened', ok: false, output: String(e) })
        }
        await reloadRepo()
      },

      dismissPublish(root) {
        flow(root, { type: 'dismiss' })
      },
    }
  })
}

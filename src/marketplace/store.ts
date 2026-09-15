import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { MarketplaceClient } from './client'
import { cardReducer, IDLE, type Card, type CardEvent } from './cards'
import type { RuleSet } from './types'

/** Key of the refresh-every-source spinner in `refreshing`. */
export const ALL = '*'

export type MarketplaceState = {
  sets: RuleSet[]
  loaded: boolean
  loading: boolean
  /** Source URL (or `ALL`) → a refresh is running. */
  refreshing: Record<string, boolean>
  /** Why listing itself failed (the command, not a source). */
  listError: string | null
  /** Tree path → the card's import state. */
  cards: Record<string, Card>
}

export type MarketplaceActions = {
  load(): Promise<void>
  refresh(url?: string): Promise<void>
  /** Adds and fetches a source. Resolves with the error text, or null on success. */
  addSource(url: string): Promise<string | null>
  removeSource(url: string): Promise<void>
  importSet(path: string, cwd: string): Promise<void>
  dismiss(path: string): void
}

export type MarketplaceStore = StoreApi<MarketplaceState & MarketplaceActions>

export function createMarketplaceStore(client: MarketplaceClient): MarketplaceStore {
  return createZustand<MarketplaceState & MarketplaceActions>((set, get) => {
    const card = (path: string, e: CardEvent) =>
      set((s) => ({ cards: { ...s.cards, [path]: cardReducer(s.cards[path] ?? IDLE, e) } }))
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
      },

      dismiss(path) {
        card(path, { type: 'dismiss' })
      },
    }
  })
}

import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { GithubClient } from './client'
import type { Auth, Board, Issue } from './types'

export type IssuesSlot = { list: Issue[]; error: string | null; at: number }
export type BoardSlot = { board: Board | null; error: string | null; loading: boolean; at: number }

export type GithubState = {
  /** null until the first `gh_auth` answers. */
  auth: Auth | null
  /** Every open issue per repo root; views filter by label themselves. */
  issues: Record<string, IssuesSlot>
  boards: Record<string, BoardSlot>
}
export type GithubActions = {
  loadAuth(): Promise<Auth | null>
  /** After "Entrar no GitHub": re-reads auth every `everyMs` until logged in or `tries` run out. */
  watchLogin(everyMs?: number, tries?: number): () => void
  loadIssues(root: string): Promise<void>
  loadBoard(root: string): Promise<void>
}
export type GithubStore = StoreApi<GithubState & GithubActions>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The Rust side caches `gh` for a minute; this store only keeps the last answer per repo
 *  and never runs two identical calls at once. */
export function createGithubStore(client: GithubClient, now = () => Date.now()): GithubStore {
  const inflight = new Map<string, Promise<unknown>>()
  const once = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
    const cur = inflight.get(key)
    if (cur) return cur as Promise<T>
    const p = run().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  return createZustand<GithubState & GithubActions>((set, get) => ({
    auth: null,
    issues: {},
    boards: {},

    loadAuth() {
      return once('auth', async () => {
        try {
          const auth = await client.auth()
          if (auth && typeof auth.installed === 'boolean') set({ auth })
        } catch {
          /* keep the last answer */
        }
        return get().auth
      })
    },

    watchLogin(everyMs = 3000, tries = 60) {
      let left = tries
      const timer = setInterval(() => {
        if (left-- <= 0) return clearInterval(timer)
        void get().loadAuth().then((a) => a?.logged && clearInterval(timer))
      }, everyMs)
      return () => clearInterval(timer)
    },

    loadIssues(root) {
      return once(`issues:${root}`, async () => {
        try {
          const list = await client.issues(root, [])
          if (!Array.isArray(list)) throw new Error('gh_issues: unexpected answer')
          set((s) => ({ issues: { ...s.issues, [root]: { list, error: null, at: now() } } }))
        } catch (e) {
          set((s) => ({ issues: { ...s.issues, [root]: { list: s.issues[root]?.list ?? [], error: message(e), at: now() } } }))
        }
      })
    },

    loadBoard(root) {
      return once(`board:${root}`, async () => {
        set((s) => ({ boards: { ...s.boards, [root]: { ...(s.boards[root] ?? { board: null, error: null, at: 0 }), loading: true } } }))
        try {
          const board = await client.project(root)
          set((s) => ({ boards: { ...s.boards, [root]: { board, error: null, loading: false, at: now() } } }))
        } catch (e) {
          set((s) => ({ boards: { ...s.boards, [root]: { board: null, error: message(e), loading: false, at: now() } } }))
        }
      })
    },
  }))
}

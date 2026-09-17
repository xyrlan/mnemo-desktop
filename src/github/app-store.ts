import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createGithubStore, type GithubActions, type GithubState } from './store'
import { tauriGithub } from './client'

export const githubStore = createGithubStore(tauriGithub)
export const useGithub = <T,>(sel: (s: GithubState & GithubActions) => T) => useStore(githubStore, sel)

/** Which issues of one repo are picked for batch dispatch. Kept separate from `githubStore`
 *  (its state comes from `store.ts`, which this round leaves untouched). `root` scopes the
 *  picks: switching repos starts a fresh selection rather than carrying stale numbers over. */
export type SelectionState = { root: string | null; ns: number[] }
export type SelectionActions = {
  /** `order` is the dispatchable issue numbers as currently shown, for shift-click's range. */
  pick(root: string, order: number[], n: number, mods: { shift: boolean; meta: boolean }): void
  clearSelection(): void
}
export type SelectionStore = StoreApi<SelectionState & SelectionActions>

export const selectionStore: SelectionStore = createStore((set, get) => ({
  root: null,
  ns: [],

  pick(root, order, n, mods) {
    const cur = get()
    const sameRoot = cur.root === root
    if (mods.meta) {
      const base = sameRoot ? cur.ns : []
      set({ root, ns: base.includes(n) ? base.filter((x) => x !== n) : [...base, n] })
      return
    }
    if (mods.shift && sameRoot && cur.ns.length) {
      const anchor = cur.ns[cur.ns.length - 1]
      const ai = order.indexOf(anchor)
      const ni = order.indexOf(n)
      if (ai === -1 || ni === -1) {
        set({ root, ns: [n] })
        return
      }
      const [lo, hi] = ai < ni ? [ai, ni] : [ni, ai]
      set({ root, ns: order.slice(lo, hi + 1) })
      return
    }
    set({ root, ns: [n] })
  },

  clearSelection() {
    set({ root: null, ns: [] })
  },
}))
export const useSelection = <T,>(sel: (s: SelectionState & SelectionActions) => T) => useStore(selectionStore, sel)

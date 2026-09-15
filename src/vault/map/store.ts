import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

export type MapState = {
  /** The vault pane shows the map instead of its health or pages mode. */
  open: boolean
  /** `''` for the whole vault, else `agent:<name>`. */
  scope: string
  /** Every agent a whole-vault map has named: the scopes to offer. */
  agents: string[]
}

export type MapActions = {
  setOpen(open: boolean): void
  setScope(scope: string): void
  noteAgents(agents: readonly string[]): void
}

export type MapStore = StoreApi<MapState & MapActions>

/** Kept apart from the vault store (its `mode` is the table's and the tree's). */
export function createMapStore(): MapStore {
  return createZustand<MapState & MapActions>((set, get) => ({
    open: false,
    scope: '',
    agents: [],
    setOpen: (open) => set({ open }),
    setScope: (scope) => set({ scope }),
    noteAgents(agents) {
      const merged = [...new Set([...get().agents, ...agents])]
      if (merged.length !== get().agents.length) set({ agents: merged })
    },
  }))
}

export const mapStore = createMapStore()
export const useMap = <T,>(sel: (s: MapState & MapActions) => T) => useStore(mapStore, sel)

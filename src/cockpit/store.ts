import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

export type CockpitState = {
  /** The row whose drawer is open, or null when none is. One slot and never a list: at most one
   *  drawer is open at a time, so a second row's affordance swaps the content rather than
   *  stacking a panel on top of the first. The value is a row key (`inbox.ts` already namespaces
   *  those by kind); a row that grows two drawers namespaces further. */
  drawer: string | null
}

export type CockpitActions = {
  openDrawer(key: string): void
  /** Shuts the window, never the work behind it: this clears `drawer` and nothing else, so what
   *  a drawer was showing (a running job, a conversation) outlives it. */
  closeDrawer(): void
  /** What a row's drawer affordance runs: opens `key`, or closes it when it is already the open
   *  one. Clicking another row's swaps to it. */
  toggleDrawer(key: string): void
}

export type CockpitStore = StoreApi<CockpitState & CockpitActions>

/** The cockpit's own state, the part that outlives a render of the list. It has no backend and
 *  no other store to talk to, so it takes nothing. */
export function createCockpitStore(): CockpitStore {
  return createZustand<CockpitState & CockpitActions>((set, get) => ({
    drawer: null,
    openDrawer: (key) => set({ drawer: key }),
    closeDrawer: () => set({ drawer: null }),
    toggleDrawer: (key) => set({ drawer: get().drawer === key ? null : key }),
  }))
}

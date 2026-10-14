import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type NexusState = {
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
}

/** Whether the Nexus drawer is open: the sidebar entry and `nexus.toggle` flip it. */
export const nexusStore: StoreApi<NexusState> = createStore<NexusState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

export const useNexus = <T,>(sel: (s: NexusState) => T): T => useStore(nexusStore, sel)

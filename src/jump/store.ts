import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** Whether the jump palette is open. `worktree.jump` toggles it; the palette closes itself on
 *  Escape, a click outside, or a jump. */
export type JumpState = { open: boolean; setOpen(open: boolean): void; toggle(): void }

export const jumpStore = createStore<JumpState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

export const useJump = <T,>(sel: (s: JumpState) => T): T => useStore(jumpStore, sel)

import type React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** The shell's signatures, as the wave-B contract gives them (`shell` piece:
 *  `src/shell/slots.ts`, `src/shell/store.ts`). */
export type ShellSlot = 'left-sidebar' | 'right-sidebar' | 'status-bar' | 'titlebar-tabs' | 'titlebar-right' | 'overlay'
export type ShellState = {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  toggleLeft(): void
  toggleRight(): void
  setLeftWidth(px: number): void
  setRightWidth(px: number): void
}
type Slots = { mountInSlot(slot: ShellSlot, component: React.ComponentType): () => void }
type ShellStore = { useShell<T>(sel: (s: ShellState) => T): T }

// The shell is built beside this piece, in parallel. A glob finds its modules when they are there
// and nothing when they are not, so this compiles and runs before the shell lands and wires itself
// to the real one once it does, with no edit here.
const slots = Object.values(import.meta.glob<Slots>('../shell/slots.ts', { eager: true }))[0]
const shell = Object.values(import.meta.glob<ShellStore>('../shell/store.ts', { eager: true }))[0]

/** Without the shell: an open sidebar at Orca's default width, so the panel can be rendered and
 *  tested on its own. */
export const standaloneShell = createStore<ShellState>((set) => ({
  leftOpen: true,
  rightOpen: true,
  leftWidth: 280,
  rightWidth: 320,
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setLeftWidth: (px) => set({ leftWidth: px }),
  setRightWidth: (px) => set({ rightWidth: px }),
}))

export const hasShell = Boolean(slots && shell)

export const mountInSlot: Slots['mountInSlot'] = slots?.mountInSlot ?? (() => () => {})

export const useShell: ShellStore['useShell'] = shell?.useShell ?? ((sel) => useStore(standaloneShell, sel))

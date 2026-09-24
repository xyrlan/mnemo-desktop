import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Fleet } from '../fleet/types'
import type { Actions } from '../layout/store'
import type { DashboardCard } from './model'

export type DashboardState = {
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
}

export const dashboardStore: StoreApi<DashboardState> = createStore<DashboardState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

export const useDashboard = <T,>(sel: (s: DashboardState) => T): T => useStore(dashboardStore, sel)

/** What a card click needs from the layout and the fleet. */
export type RevealDeps = {
  layout: () => Pick<Actions, 'switchWorktree' | 'goToPane'>
  fleet: () => Pick<Fleet, 'markRead'>
}

/** Show the card's worktree with its agent's pane focused, and count its news as seen. An agent
 *  with no pane on screen (a dispatched child running headless) shows its worktree only. */
export function revealCard(card: Pick<DashboardCard, 'worktreePath' | 'paneId'>, deps: RevealDeps): void {
  // `switchWorktree` swaps the layout before its first await, so the pane is in `tabs` after it.
  void deps.layout().switchWorktree(card.worktreePath)
  if (card.paneId !== null) deps.layout().goToPane(card.paneId)
  deps.fleet().markRead(card.worktreePath)
}

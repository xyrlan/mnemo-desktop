import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

export type CommitOpenState = {
  /** The worktree the composer is open for; null while it is closed. */
  worktree: string | null
  /** Bumped by every open, so opening it again starts it over. */
  seq: number
}

/** Whether the commit composer is open, and for which worktree. Free of Tauri, so any piece
 *  (the diff tab, say) can import `openCommit` into its own tests. */
export const commitOpenStore = createStore<CommitOpenState>(() => ({ worktree: null, seq: 0 }))
export const useCommitOpen = <T,>(sel: (s: CommitOpenState) => T): T => useStore(commitOpenStore, sel)

/** Opens the commit composer for `worktree`: its changes, an AI-written message, Commit, Push
 *  and Create PR. */
export function openCommit(worktree: string): void {
  commitOpenStore.setState((s) => ({ worktree, seq: s.seq + 1 }))
}

export function closeCommit(): void {
  commitOpenStore.setState({ worktree: null })
}

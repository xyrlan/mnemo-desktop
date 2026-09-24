import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Candidate } from './cleanup-model'

/** A card's "Remove" that needs a yes first: the tree has changes, or agents at work in it. */
export type AskRemove = { path: string; name: string; branch: string | null; dirty: boolean; live: number }

export type ArchiveState = {
  /** Worktrees being removed, card or batch: their cards say so until the fleet drops them. */
  removing: ReadonlySet<string>
  ask: AskRemove | null
  cleanup: {
    open: boolean
    /** The list, or the batch's confirmation (with its progress once it runs). */
    step: 'list' | 'confirm'
    scanning: boolean
    /** The stale worktrees, repo by repo in sidebar order. */
    candidates: Candidate[]
    /** Why the others stay; empty when none did. */
    kept: string
    /** A repo git could not be asked about, one line each. */
    errors: string[]
    selected: ReadonlySet<string>
    progress: { done: number; failed: number; total: number } | null
    /** Why a worktree of the last batch was not removed, by path. */
    failures: Record<string, string>
  }
}

export const closedCleanup: ArchiveState['cleanup'] = {
  open: false,
  step: 'list',
  scanning: false,
  candidates: [],
  kept: '',
  errors: [],
  selected: new Set(),
  progress: null,
  failures: {},
}

export const archiveStore = createStore<ArchiveState>(() => ({ removing: new Set(), ask: null, cleanup: closedCleanup }))
export const useArchive = <T,>(sel: (s: ArchiveState) => T): T => useStore(archiveStore, sel)

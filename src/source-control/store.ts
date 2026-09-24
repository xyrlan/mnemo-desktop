import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ScmClient, ScmStatus } from './client'

/** One worktree's changes as last read. */
export type Tree = { status: ScmStatus | null; loading: boolean; error: string | null }

export type ScmState = {
  /** By worktree path. */
  trees: Record<string, Tree>
  /** A stage, unstage or discard running, by worktree path. */
  busy: Record<string, boolean>
  /** What the last stage, unstage or discard said when it failed, by worktree path. */
  failed: Record<string, string | null>
  /** Reads the worktree's changes again. */
  load(worktree: string): Promise<void>
  stage(worktree: string, paths: string[]): Promise<void>
  unstage(worktree: string, paths: string[]): Promise<void>
  discard(worktree: string, tracked: string[], untracked: string[]): Promise<void>
  dismiss(worktree: string): void
}

const EMPTY: Tree = { status: null, loading: false, error: null }

/** What a failure says: Tauri refuses with a string, anything else with an Error. */
export const said = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)) || 'It failed without saying why.'

export function createScmStore(client: ScmClient): StoreApi<ScmState> {
  // A reply that lands after a newer read of the same tree is dropped.
  const turns = new Map<string, number>()
  // Steps running per tree: busy until the last of them is done.
  const running = new Map<string, number>()

  return createStore<ScmState>((set, get) => {
    const tree = (worktree: string, patch: Partial<Tree>) =>
      set((s) => ({ trees: { ...s.trees, [worktree]: { ...(s.trees[worktree] ?? EMPTY), ...patch } } }))

    /** Runs one git step, then reads the tree again whatever it did: a step that failed halfway
     *  may still have changed something. */
    const step = async (worktree: string, run: () => Promise<void>) => {
      running.set(worktree, (running.get(worktree) ?? 0) + 1)
      set((s) => ({ busy: { ...s.busy, [worktree]: true }, failed: { ...s.failed, [worktree]: null } }))
      try {
        await run()
      } catch (e) {
        set((s) => ({ failed: { ...s.failed, [worktree]: said(e) } }))
      }
      await get().load(worktree)
      const left = (running.get(worktree) ?? 1) - 1
      running.set(worktree, left)
      if (left === 0) set((s) => ({ busy: { ...s.busy, [worktree]: false } }))
    }

    return {
      trees: {},
      busy: {},
      failed: {},

      async load(worktree) {
        const n = (turns.get(worktree) ?? 0) + 1
        turns.set(worktree, n)
        tree(worktree, { loading: true })
        try {
          const status = await client.status(worktree)
          if (turns.get(worktree) === n) tree(worktree, { status, loading: false, error: null })
        } catch (e) {
          if (turns.get(worktree) === n) tree(worktree, { loading: false, error: said(e) })
        }
      },

      stage: (worktree, paths) => step(worktree, () => client.stage(worktree, paths)),
      unstage: (worktree, paths) => step(worktree, () => client.unstage(worktree, paths)),
      discard: (worktree, tracked, untracked) => step(worktree, () => client.discard(worktree, tracked, untracked)),

      dismiss(worktree) {
        set((s) => ({ failed: { ...s.failed, [worktree]: null } }))
      },
    }
  })
}

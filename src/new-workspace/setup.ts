import { createStore, type StoreApi } from 'zustand/vanilla'

/** The id prefix `worktree.rs` runs a new tree's setup command under (`worktree-setup:<path>`). */
export const SETUP_PREFIX = 'worktree-setup:'
/** Lines kept per run: enough to read why it failed. */
export const KEEP_LINES = 40

export type SetupRun = {
  id: string
  /** The tree and the workspace name it was created as; set by `track`. */
  path: string
  name: string
  state: 'running' | 'done' | 'failed'
  code: number | null
  lines: string[]
  /** Created from the composer, so shown; a run only heard about is kept but not drawn. */
  tracked: boolean
}

export type SetupState = {
  /** Runs by job id, in the order they were first heard of. */
  runs: Record<string, SetupRun>
  line(id: string, line: string): void
  exit(id: string, code: number | null): void
  track(id: string, tree: { path: string; name: string }): void
  dismiss(id: string): void
}

const fresh = (id: string): SetupRun => ({ id, path: id.slice(SETUP_PREFIX.length), name: '', state: 'running', code: null, lines: [], tracked: false })

/** Setup runs of new worktrees, fed by `job-line` / `job-exit`. Every `worktree-setup:` event is
 *  recorded, tracked or not, because a quick setup can finish before `createWorktree` returns the
 *  job id; `track` then shows what was already heard. A line for a run that already ended is a new
 *  run of the same tree (same id), which starts over. */
export function createSetupStore(): StoreApi<SetupState> {
  return createStore<SetupState>((set) => ({
    runs: {},
    line(id, line) {
      if (!id.startsWith(SETUP_PREFIX)) return
      set((s) => {
        const was = s.runs[id]
        const run = !was || was.state !== 'running' ? { ...fresh(id), ...(was && { name: was.name, path: was.path }) } : was
        return { runs: { ...s.runs, [id]: { ...run, lines: [...run.lines, line].slice(-KEEP_LINES) } } }
      })
    },
    exit(id, code) {
      if (!id.startsWith(SETUP_PREFIX)) return
      set((s) => {
        const run = s.runs[id] ?? fresh(id)
        return { runs: { ...s.runs, [id]: { ...run, state: code === 0 ? 'done' : 'failed', code } } }
      })
    },
    track(id, tree) {
      set((s) => ({ runs: { ...s.runs, [id]: { ...(s.runs[id] ?? fresh(id)), path: tree.path, name: tree.name, tracked: true } } }))
    },
    dismiss(id) {
      set((s) => {
        const runs = { ...s.runs }
        delete runs[id]
        return { runs }
      })
    },
  }))
}

/** The runs to draw, oldest first. */
export const shownRuns = (s: Pick<SetupState, 'runs'>): SetupRun[] => Object.values(s.runs).filter((r) => r.tracked)

import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** One line a job printed. `out` and `err` are read apart, so two lines of different streams
 *  are in the order they arrived, which is not necessarily the order they were written. `app`
 *  is the app's own line between the steps of a job (`merge.ts`: what the gate read). */
export type JobLine = { stream: 'out' | 'err' | 'app'; line: string }

/** A process the cockpit ran headless (`merge`, `land`) and everything it said. */
export type Job = {
  /** The drawer's title: `merge · PR #412`. */
  title: string
  lines: JobLine[]
  running: boolean
  /** The exit status once it ended; `null` while running, or when a signal ended it. */
  code: number | null
  /** Why it never started, or never finished reporting: the job failed. */
  error?: string
}

/** A job's outcome as its row says it. */
export const jobState = (j: Job): 'running' | 'ok' | 'failed' => (j.running ? 'running' : j.code === 0 && !j.error ? 'ok' : 'failed')

/** A talkative job keeps its last lines, not every line: the drawer is a window, not an archive. */
export const MAX_LINES = 5000

export type CockpitState = {
  /** The row whose drawer is open, or null when none is. One slot and never a list: at most one
   *  drawer is open at a time, so a second row's affordance swaps the content rather than
   *  stacking a panel on top of the first. The value is a row key (`inbox.ts` already namespaces
   *  those by kind); a row that grows two drawers namespaces further. */
  drawer: string | null
  /** Jobs by the key of the row that ran them. Kept after they end, so closing the drawer or
   *  scrolling the row away does not lose the log; a new run of the same row replaces it. */
  jobs: Record<string, Job>
}

export type CockpitActions = {
  openDrawer(key: string): void
  /** Shuts the window, never the work behind it: this clears `drawer` and nothing else, so what
   *  a drawer was showing (a running job, a conversation) outlives it. */
  closeDrawer(): void
  /** What a row's drawer affordance runs: opens `key`, or closes it when it is already the open
   *  one. Clicking another row's swaps to it. */
  toggleDrawer(key: string): void
  /** Registers a new run for `key`; false (and nothing changes) while one is still running. */
  jobStart(key: string, title: string): boolean
  jobLine(key: string, line: JobLine): void
  /** The job ended. A failure opens its drawer by itself; a success does not — success is silence.
   *  `error` fails it whatever the code: the process ran, but what it was for did not happen. */
  jobExit(key: string, code: number | null, error?: string): void
  /** It could not be started (or its exit was never heard): failed, and its drawer opens. */
  jobFailed(key: string, error: string): void
}

export type CockpitStore = StoreApi<CockpitState & CockpitActions>

/** The cockpit's own state, the part that outlives a render of the list. It has no backend and
 *  no other store to talk to, so it takes nothing. */
export function createCockpitStore(): CockpitStore {
  return createZustand<CockpitState & CockpitActions>((set, get) => {
    // Only a running job takes lines or an exit. Anything else is a stale event — a previous
    // run's, or one from before a window reload — and would write into a log it is not part of.
    const end = (key: string, ended: Partial<Job>) => {
      const j = get().jobs[key]
      if (!j?.running) return
      const done = { ...j, ...ended, running: false }
      // A failure opens its drawer by itself; a success does not.
      set({ jobs: { ...get().jobs, [key]: done }, ...(jobState(done) === 'failed' ? { drawer: key } : {}) })
    }
    return {
      drawer: null,
      jobs: {},
      openDrawer: (key) => set({ drawer: key }),
      closeDrawer: () => set({ drawer: null }),
      toggleDrawer: (key) => set({ drawer: get().drawer === key ? null : key }),
      jobStart: (key, title) => {
        if (get().jobs[key]?.running) return false
        set({ jobs: { ...get().jobs, [key]: { title, lines: [], running: true, code: null } } })
        return true
      },
      jobLine: (key, line) => {
        const j = get().jobs[key]
        if (!j?.running) return
        const lines = j.lines.length < MAX_LINES ? [...j.lines, line] : [...j.lines.slice(1 - MAX_LINES), line]
        set({ jobs: { ...get().jobs, [key]: { ...j, lines } } })
      },
      jobExit: (key, code, error) => end(key, error === undefined ? { code } : { code, error }),
      jobFailed: (key, error) => end(key, { error }),
    }
  })
}

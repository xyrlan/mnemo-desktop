import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Check, CheckDetails, ChecksClient, ChecksView, MergeMethod, Merged } from './client'
import type { Sent } from './agent'
import { detailsKey, fixPrompt, type Failing } from './model'

export type TreeState = {
  view: ChecksView | null
  loading: boolean
  /** The last read's failure; the view read before it stays shown under it. */
  error: string | null
  /** When `view` was read (ms). */
  at: number | null
}

export type DetailState = { loading: boolean; details: CheckDetails | null; error: string | null }

/** What runs on a worktree's PR now, one thing at a time: a merge, marking it ready, or a send
 *  to its agent (`id`: `fix`, or the thread or comment sent), since two sends at once would
 *  interleave their keystrokes in one terminal. */
export type Busy = { kind: 'merge' | 'ready' | 'send'; id?: string } | null

export type ChecksState = {
  trees: Record<string, TreeState>
  /** By `detailsKey(check)`. */
  details: Record<string, DetailState>
  busy: Record<string, Busy>
  /** Reads `worktree`'s PR again; skipped when the last read is younger than `maxAgeMs`. A
   *  reply that a newer read overtook is dropped. */
  load(worktree: string, opts?: { maxAgeMs?: number }): Promise<void>
  /** A check's job, read once per state of the check; concurrent asks share one read. */
  loadDetails(worktree: string, check: Check): Promise<DetailState>
  /** Merges the PR shown, pinned to the head shown, then reads it again. Rejects with why not. */
  merge(worktree: string, method: MergeMethod): Promise<Merged>
  ready(worktree: string): Promise<void>
  /** Fix's prompt: the failing checks of the PR shown, with their jobs read (at most
   *  `FIX_JOBS`). */
  fixText(worktree: string): Promise<string>
  /** Builds `prompt` and hands it to `deliver`, as `busy` `send` with `id`. */
  send(worktree: string, id: string, prompt: () => Promise<string> | string, deliver: (text: string) => Promise<Sent>): Promise<Sent>
  setBusy(worktree: string, busy: Busy): void
}

/** Jobs Fix reads for their logs, as Orca bounds it (`PR_CHECK_LOG_TAIL_JOB_LIMIT`). */
export const FIX_JOBS = 5

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const EMPTY: TreeState = { view: null, loading: false, error: null, at: null }

export function createChecksStore(client: ChecksClient, now: () => number = Date.now): StoreApi<ChecksState> {
  const seq = new Map<string, number>()
  const inflight = new Map<string, Promise<DetailState>>()

  const store = createStore<ChecksState>((set, get) => {
    const patchTree = (worktree: string, patch: Partial<TreeState>) =>
      set((s) => ({ trees: { ...s.trees, [worktree]: { ...(s.trees[worktree] ?? EMPTY), ...patch } } }))

    /** Runs `run` as `busy`, refusing while something else runs; `after` follows a run that
     *  happened, once `busy` is cleared. */
    async function exclusive<T>(worktree: string, busy: NonNullable<Busy>, run: () => Promise<T>, after?: () => Promise<void>): Promise<T> {
      if (get().busy[worktree]) throw new Error('Something else is still running on this pull request')
      get().setBusy(worktree, busy)
      try {
        return await run()
      } finally {
        get().setBusy(worktree, null)
        await after?.()
      }
    }

    /** A write to GitHub, then a fresh read of what it changed. */
    const write = <T,>(worktree: string, kind: 'merge' | 'ready', run: () => Promise<T>) => exclusive(worktree, { kind }, run, () => get().load(worktree))

    const shown = (worktree: string) => {
      const pr = get().trees[worktree]?.view?.pr
      if (!pr) throw new Error('No pull request is shown for this workspace')
      return pr
    }

    return {
      trees: {},
      details: {},
      busy: {},

      async load(worktree, opts) {
        const t = get().trees[worktree]
        if (opts?.maxAgeMs != null && t?.at != null && now() - t.at < opts.maxAgeMs) return
        const n = (seq.get(worktree) ?? 0) + 1
        seq.set(worktree, n)
        patchTree(worktree, { loading: true })
        try {
          const view = await client.read(worktree)
          if (seq.get(worktree) === n) patchTree(worktree, { view, loading: false, error: null, at: now() })
        } catch (e) {
          if (seq.get(worktree) === n) patchTree(worktree, { loading: false, error: message(e) })
        }
      },

      loadDetails(worktree, check) {
        const key = detailsKey(check)
        const have = get().details[key]
        if (have?.details) return Promise.resolve(have)
        const running = inflight.get(key)
        if (running) return running
        const put = (d: DetailState) => {
          set((s) => ({ details: { ...s.details, [key]: d } }))
          return d
        }
        put({ loading: true, details: null, error: null })
        const p = (check.url ? client.details(worktree, check.url) : Promise.reject(new Error('This check links nowhere')))
          .then(
            (details) => put({ loading: false, details, error: null }),
            (e) => put({ loading: false, details: null, error: message(e) }),
          )
          .finally(() => inflight.delete(key))
        inflight.set(key, p)
        return p
      },

      merge(worktree, method) {
        const pr = shown(worktree)
        return write(worktree, 'merge', () => client.merge(worktree, pr.number, method, pr.headSha))
      },

      ready(worktree) {
        const pr = shown(worktree)
        return write(worktree, 'ready', () => client.ready(worktree, pr.number))
      },

      async fixText(worktree) {
        const pr = shown(worktree)
        const failing = (get().trees[worktree]?.view?.checks ?? []).filter((c) => c.verdict === 'fail')
        if (!failing.length) throw new Error('No check is failing')
        const read = await Promise.all(
          failing.map(async (check, i): Promise<Failing> => {
            if (!check.jobId || i >= FIX_JOBS) return { check, details: null }
            const d = await get().loadDetails(worktree, check)
            return { check, details: d.details, error: d.error }
          }),
        )
        return fixPrompt(pr, read)
      },

      send(worktree, id, prompt, deliver) {
        return exclusive(worktree, { kind: 'send', id }, async () => deliver(await prompt()))
      },

      setBusy(worktree, busy) {
        set((s) => ({ busy: { ...s.busy, [worktree]: busy } }))
      },
    }
  })
  return store
}

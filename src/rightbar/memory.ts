import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MemoryFeed } from '../memory/types'
import type { ReviewProject } from '../learned/client'
import { parseDecided } from '../learned/types'
import type { RunResult } from '../vault/types'

/** What the Memory window reads for: a repo's folder, and the Claude session it is about (none
 *  there: the window picks a repo, not a session). */
export type MemoryTarget = { cwd: string; sessionId: string | null }

export const sameTarget = (a: MemoryTarget | null, b: MemoryTarget | null) => a?.cwd === b?.cwd && a?.sessionId === b?.sessionId

/** `now`, `12s`, `4m`, `2h`, `3d`, `5w`: how long ago `at` (ms) was. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`
  return `${Math.floor(s / (7 * 86_400))}w`
}

export type Decision = 'keep' | 'drop'

export type MemoryDeps = {
  feed(cwd: string, sessionId?: string): Promise<MemoryFeed>
  /** The repo `cwd` is in, as `mnemo inbox` is run for it; null outside one. */
  project(cwd: string): Promise<ReviewProject | null>
  step(step: 'promote' | 'drop', target: ReviewProject, keys: string[]): Promise<RunResult>
}

export type MemoryState = {
  target: MemoryTarget | null
  /** The last feed read for `target`'s worktree; kept while a newer one is read. */
  feed: MemoryFeed | null
  loading: boolean
  error: string | null
  /** Inbox keys being kept or dropped now. */
  deciding: Record<string, Decision>
  /** Inbox keys whose keep or drop failed, with what the CLI said. */
  failed: Record<string, string>
}

export type MemoryActions = {
  /** Read for `target`; nothing when it is the one shown. Another worktree's feed is cleared at
   *  once, never shown under this one's name; a new session in the same worktree keeps it until
   *  the new one arrives. */
  show(target: MemoryTarget | null): Promise<void>
  /** Read the shown target again. */
  refresh(): Promise<void>
  /** Keep (promote) or drop an inbox page, through `mnemo inbox`. It leaves the list when the CLI
   *  says it was decided, and the feed is read again. */
  decide(key: string, how: Decision): Promise<void>
}

export type MemoryStore = StoreApi<MemoryState & MemoryActions>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createMemoryStore(deps: MemoryDeps): MemoryStore {
  return createStore<MemoryState & MemoryActions>((set, get) => {
    /** Each read's number: a reply for an older one is dropped. */
    let seq = 0
    const projects = new Map<string, Promise<ReviewProject | null>>()

    async function read() {
      const t = get().target
      const mine = ++seq
      if (!t) return set({ feed: null, loading: false, error: null })
      set({ loading: true })
      try {
        const feed = await deps.feed(t.cwd, t.sessionId ?? undefined)
        if (mine === seq) set({ feed, loading: false, error: null })
      } catch (e) {
        if (mine === seq) set({ feed: null, loading: false, error: message(e) })
      }
    }

    return {
      target: null,
      feed: null,
      loading: false,
      error: null,
      deciding: {},
      failed: {},

      async show(target) {
        const was = get().target
        if (sameTarget(was, target)) return
        const moved = was?.cwd !== target?.cwd
        set({ target, ...(moved ? { feed: null, error: null, failed: {} } : {}) })
        await read()
      },

      refresh: read,

      async decide(key, how) {
        const t = get().target
        if (!t || get().deciding[key]) return
        const { [key]: _, ...failed } = get().failed
        set({ deciding: { ...get().deciding, [key]: how }, failed })
        const done = (error?: string) => {
          const { [key]: __, ...deciding } = get().deciding
          set(error === undefined ? { deciding } : { deciding, failed: { ...get().failed, [key]: error } })
        }
        try {
          if (!projects.has(t.cwd)) projects.set(t.cwd, deps.project(t.cwd))
          const project = await projects.get(t.cwd)!.catch((e) => {
            projects.delete(t.cwd)
            throw e
          })
          if (!project) return done('not in a repo mnemo knows')
          const step = how === 'keep' ? 'promote' : 'drop'
          const r = await deps.step(step, project, [key])
          const d = parseDecided(r.stdout, how === 'keep' ? 'promoted' : 'dropped')
          if (!d || !d.done.includes(key)) {
            return done(d?.failed.find((f) => f.key === key)?.error || r.stderr.trim() || r.stdout.trim() || `mnemo inbox --${step}: exit ${r.code ?? '(did not run)'}`)
          }
          const feed = get().feed
          if (feed && sameTarget(get().target, t)) set({ feed: { ...feed, inbox: feed.inbox.filter((i) => i.key !== key) } })
          done()
          await read()
        } catch (e) {
          done(message(e))
        }
      },
    }
  })
}

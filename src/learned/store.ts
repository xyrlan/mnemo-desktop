import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { RunResult } from '../vault/types'
import { runId, type LearnedClient, type ReviewProject } from './client'
import { firstExpiry, parseDecided, parseDryRun, parseListing, parseProgress, type DryRun, type LearnedPage } from './types'

export type Count = { done: number; of: number }

/** Where the review is. `consent` asks before anything reaches a model; `running` is the
 *  harvest and first extraction; `review` the checklist; `done` what the decision did. */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'consent'; dry: DryRun }
  | { kind: 'declined' }
  | { kind: 'running'; harvest: Count | null; extract: Count | null; err: string[] }
  | { kind: 'review' }
  | { kind: 'deciding' }
  | { kind: 'done'; skipped: boolean; kept: string[]; dropped: string[]; failed: { key: string; error: string }[]; expiresAt: string | null }
  | { kind: 'nothing' }
  | { kind: 'no-repo' }
  | { kind: 'error'; message: string }

export type LearnedState = {
  /** The repo under review; null until one is opened. */
  target: ReviewProject | null
  phase: Phase
  /** The pages the listing named, in its order. */
  pages: LearnedPage[]
  /** Key → kept. Every page starts checked. */
  checked: Record<string, boolean>
  /** Key → showing its excerpt. */
  expanded: Record<string, boolean>
  /** When the checklist first showed (ms), for the seconds to a decision. */
  openedAt: number | null
}

export type LearnedActions = {
  /** Opens the review of `target`: its staged backfill pages when there are some, else the
   *  consent to read its history when the dry run finds sessions, else `nothing`. Ignored
   *  while a check, a run or a decision is under way. */
  open(target: ReviewProject): Promise<void>
  /** `open` for the repo `cwd` is in; `no-repo` outside one. */
  openCwd(cwd: string | undefined): Promise<void>
  /** Goes straight to the consent with a dry run already read (the launch check's). */
  ask(target: ReviewProject, dry: DryRun): void
  /** [Read my history]: starts the run. Leaving the screen does not stop it. */
  consent(): Promise<void>
  /** [Not now] at the consent: nothing runs, and the launch check does not ask again. */
  notNow(): Promise<void>
  toggle(key: string): void
  /** The group's keep all / none. */
  setType(type: string, keep: boolean): void
  expand(key: string): void
  /** [Keep selected]: promotes the checked pages and drops the rest. */
  keep(): Promise<void>
  /** [Decide later]: decides nothing; the pages expire on their own. */
  later(): Promise<void>
}

export type LearnedStore = StoreApi<LearnedState & LearnedActions>

/** What a call said when it did not say JSON. */
const said = (r: RunResult, what: string) => r.stderr.trim() || r.stdout.trim() || `${what}: exit ${r.code ?? '(did not run)'}`

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Nothing on screen to lose: another review may take its place. */
export const settled = (p: Phase) => ['idle', 'nothing', 'no-repo', 'declined', 'done', 'error'].includes(p.kind)

const busy = (p: Phase) => p.kind === 'running' || p.kind === 'deciding' || p.kind === 'checking'

export function createLearnedStore(client: LearnedClient, now: () => number = Date.now): LearnedStore {
  return createZustand<LearnedState & LearnedActions>((set, get) => {
    const fail = (message: string) => set({ phase: { kind: 'error', message } })

    /** Reads the listing into the checklist. Resolves false when it could not. */
    async function list(target: ReviewProject): Promise<LearnedPage[] | null> {
      const r = await client.step('list', target)
      const listing = parseListing(r.stdout)
      if (!listing) {
        fail(`mnemo inbox --origin backfill --json: ${said(r, 'no listing')}`)
        return null
      }
      return listing.pages
    }

    function review(pages: LearnedPage[]) {
      if (!pages.length) return set({ phase: { kind: 'nothing' }, pages: [] })
      set({
        phase: { kind: 'review' },
        pages,
        checked: Object.fromEntries(pages.map((p) => [p.key, true])),
        expanded: {},
        openedAt: now(),
      })
    }

    /** One row per review: counts and time only, never page text. */
    function measure(kept: number, dropped: number, failed: number, skipped: boolean) {
      const s = get()
      client.log({
        event: 'install-review',
        project: s.target?.project ?? '',
        shown: s.pages.length,
        kept,
        dropped,
        failed,
        seconds: s.openedAt === null ? null : Math.round((now() - s.openedAt) / 1000),
        skipped,
      })
    }

    /** A call that decides `keys`; every key it could not decide comes back as failed. */
    async function decide(step: 'promote' | 'drop', target: ReviewProject, keys: string[]) {
      if (!keys.length) return { done: [], failed: [] }
      const field = step === 'promote' ? 'promoted' : 'dropped'
      try {
        const r = await client.step(step, target, keys)
        const d = parseDecided(r.stdout, field)
        if (d) return d
        const error = said(r, `mnemo inbox --${step}`)
        return { done: [], failed: keys.map((key) => ({ key, error })) }
      } catch (e) {
        return { done: [], failed: keys.map((key) => ({ key, error: message(e) })) }
      }
    }

    return {
      target: null,
      phase: { kind: 'idle' },
      pages: [],
      checked: {},
      expanded: {},
      openedAt: null,

      async open(target) {
        // A run under way keeps the screen, whichever repo asked: it is still what the screen shows.
        if (busy(get().phase)) return
        set({ target, phase: { kind: 'checking' }, pages: [], checked: {}, expanded: {}, openedAt: null })
        try {
          const pages = await list(target)
          if (!pages) return
          if (pages.length) return review(pages)
          const r = await client.step('dry-run', target)
          const dry = parseDryRun(r.stdout)
          if (!dry) return fail(`mnemo backfill --dry-run --json: ${said(r, 'no estimate')}`)
          set({ phase: dry.sessions > 0 ? { kind: 'consent', dry } : { kind: 'nothing' } })
        } catch (e) {
          fail(message(e))
        }
      },

      async openCwd(cwd) {
        if (busy(get().phase)) return
        let target: ReviewProject | null = null
        try {
          target = cwd ? await client.project(cwd) : null
        } catch (e) {
          return fail(message(e))
        }
        if (!target) return set({ target: null, phase: { kind: 'no-repo' } })
        await get().open(target)
      },

      ask(target, dry) {
        // A checklist or a run on screen is never replaced by another repo's question.
        if (!settled(get().phase)) return
        set({ target, phase: { kind: 'consent', dry }, pages: [], checked: {}, expanded: {}, openedAt: null })
      },

      async consent() {
        const { target, phase } = get()
        if (!target || phase.kind !== 'consent') return
        const id = runId(target.project)
        set({ phase: { kind: 'running', harvest: null, extract: null, err: [] } })
        const running = () => {
          const p = get().phase
          return p.kind === 'running' ? p : null
        }
        let stop: () => void = () => {}
        let finished = false
        const ended = new Promise<number | null>((resolve) => {
          // Listening first: the first line can arrive before `run` resolves.
          void client
            .onJob({
              line(from, stream, line) {
                const p = running()
                if (from !== id || !p) return
                if (stream === 'err') return set({ phase: { ...p, err: [...p.err, line].slice(-20) } })
                const e = parseProgress(line)
                if (e?.event === 'done') finished = true
                if (e?.event === 'harvest') set({ phase: { ...p, harvest: { done: e.done, of: e.of } } })
                if (e?.event === 'extract') set({ phase: { ...p, extract: { done: e.done, of: e.of } } })
              },
              exit(from, code) {
                if (from === id) resolve(code)
              },
            })
            .then((s) => (stop = s), () => resolve(null))
        })
        try {
          await client.run(target)
        } catch (e) {
          stop()
          return fail(`mnemo backfill: ${message(e)}`)
        }
        const code = await ended
        stop()
        const err = running()?.err ?? []
        // The spec exits 0 when the sweep finished, some sessions failed or not, and 2 when it
        // could not run. A `done` event is the sweep finishing whatever the code says: today's
        // backfill still exits 1 when a session failed.
        if (code !== 0 && !finished) return fail(`mnemo backfill exited ${code ?? 'on a signal'}${err.length ? `:\n${err.join('\n')}` : ''}`)
        const pages = await list(target)
        if (pages) review(pages)
      },

      async notNow() {
        const { target, phase } = get()
        if (!target || phase.kind !== 'consent') return
        set({ phase: { kind: 'declined' } })
        await client.record(target.project, 'not-now').catch(() => {})
      },

      toggle(key) {
        if (get().phase.kind !== 'review') return
        set((s) => ({ checked: { ...s.checked, [key]: !s.checked[key] } }))
      },

      setType(type, keep) {
        if (get().phase.kind !== 'review') return
        set((s) => ({ checked: { ...s.checked, ...Object.fromEntries(s.pages.filter((p) => p.type === type).map((p) => [p.key, keep])) } }))
      },

      expand(key) {
        set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } }))
      },

      async keep() {
        const { target, phase, pages, checked } = get()
        if (!target || phase.kind !== 'review') return
        set({ phase: { kind: 'deciding' } })
        const keys = (keep: boolean) => pages.filter((p) => !!checked[p.key] === keep).map((p) => p.key)
        // One after the other: both append to the same ledger.
        const promoted = await decide('promote', target, keys(true))
        const dropped = await decide('drop', target, keys(false))
        const failed = [...promoted.failed, ...dropped.failed]
        measure(promoted.done.length, dropped.done.length, failed.length, false)
        set({
          phase: {
            kind: 'done',
            skipped: false,
            kept: promoted.done,
            dropped: dropped.done,
            failed,
            expiresAt: firstExpiry(pages.filter((p) => failed.some((f) => f.key === p.key))),
          },
        })
        await client.record(target.project, 'kept').catch(() => {})
      },

      async later() {
        const { target, phase, pages } = get()
        if (!target || phase.kind !== 'review') return
        measure(0, 0, 0, true)
        set({ phase: { kind: 'done', skipped: true, kept: [], dropped: [], failed: [], expiresAt: firstExpiry(pages) } })
        await client.record(target.project, 'later').catch(() => {})
      },
    }
  })
}

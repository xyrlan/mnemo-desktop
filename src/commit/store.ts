import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CommitClient, Committed, PullRequest, Status } from './client'

/** A step whose failure the composer shows, each in its own notice. */
export type Step = 'status' | 'message' | 'commit' | 'push' | 'pr'

export type PrForm = { base: string; title: string; body: string; draft: boolean }

export type CommitState = {
  worktree: string
  status: Status | null
  loading: boolean
  /** The paths the next commit takes. */
  picked: readonly string[]
  message: string
  generating: boolean
  committing: boolean
  pushing: boolean
  /** The last commit made here, for the notice under the buttons. */
  committed: Committed | null
  /** What the last push did. */
  pushed: string | null
  /** The branch's pull request: found, or just created. */
  pr: PullRequest | null
  /** The pull request being written; null while the form is closed. */
  prForm: PrForm | null
  drafting: boolean
  creating: boolean
  errors: Partial<Record<Step, string>>
}

export type CommitActions = {
  /** Reads the worktree's changes again. Paths seen before keep their pick; new ones start picked. */
  load(): Promise<void>
  findPr(): Promise<void>
  toggle(path: string): void
  pickAll(on: boolean): void
  setMessage(message: string): void
  /** Asks `claude` for a message for the picked paths. */
  generate(): Promise<void>
  /** Drops the message being generated: its answer is ignored when it comes. */
  stopGenerating(): void
  commit(opts?: { andPush?: boolean }): Promise<void>
  push(): Promise<boolean>
  /** Opens the PR form on the base branch and drafts its title and body. */
  openPr(): void
  closePr(): void
  setPr(patch: Partial<PrForm>): void
  draftPr(): Promise<void>
  /** Pushes first when the remote lacks commits, then `gh pr create`. */
  createPr(): Promise<void>
  dismiss(step: Step): void
}

export type CommitStore = StoreApi<CommitState & CommitActions>

/** What a failure says: Tauri refuses with a string, anything else with an Error. */
export const said = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)) || 'It failed without saying why.'

/** Paths that can be picked: a conflict is resolved first. */
export const pickable = (status: Status | null): string[] => (status?.changes ?? []).filter((c) => !c.conflicted).map((c) => c.path)

/** The composer's state for one worktree, over `client`. One per open composer, so a late
 *  answer for a closed one lands in a store nobody reads. */
export function createCommitStore(client: CommitClient, worktree: string): CommitStore {
  let seen = new Set<string>()
  // Bumped by every generate and by stop, so only the latest ask may write the message.
  let asking = 0

  return createStore<CommitState & CommitActions>((set, get) => {
    const fail = (step: Step, e: unknown) => set((s) => ({ errors: { ...s.errors, [step]: said(e) } }))
    const clear = (step: Step) => set((s) => (s.errors[step] === undefined ? {} : { errors: { ...s.errors, [step]: undefined } }))

    return {
      worktree,
      status: null,
      loading: false,
      picked: [],
      message: '',
      generating: false,
      committing: false,
      pushing: false,
      committed: null,
      pushed: null,
      pr: null,
      prForm: null,
      drafting: false,
      creating: false,
      errors: {},

      async load() {
        set({ loading: true })
        try {
          const status = await client.status(worktree)
          const paths = pickable(status)
          const was = new Set(get().picked)
          const picked = paths.filter((p) => was.has(p) || !seen.has(p))
          seen = new Set(paths)
          set({ status, picked, loading: false })
          clear('status')
        } catch (e) {
          set({ loading: false })
          fail('status', e)
        }
      },

      async findPr() {
        try {
          const pr = await client.findPr(worktree)
          set({ pr })
          clear('pr')
        } catch (e) {
          fail('pr', e)
        }
      },

      toggle(path) {
        set((s) => ({ picked: s.picked.includes(path) ? s.picked.filter((p) => p !== path) : [...s.picked, path] }))
      },

      pickAll(on) {
        set({ picked: on ? pickable(get().status) : [] })
      },

      setMessage(message) {
        set({ message })
      },

      async generate() {
        const paths = [...get().picked]
        if (paths.length === 0 || get().generating) return
        const mine = ++asking
        set({ generating: true })
        clear('message')
        try {
          const message = await client.message(worktree, paths)
          if (mine === asking) set({ message, generating: false })
        } catch (e) {
          if (mine !== asking) return
          set({ generating: false })
          fail('message', e)
        }
      },

      stopGenerating() {
        asking++
        set({ generating: false })
      },

      async commit(opts) {
        const { picked, message, committing } = get()
        if (committing || picked.length === 0 || !message.trim()) return
        set({ committing: true, committed: null, pushed: null })
        clear('commit')
        try {
          const committed = await client.commit(worktree, [...picked], message)
          set({ committed, message: '', committing: false })
        } catch (e) {
          set({ committing: false })
          fail('commit', e)
          return
        }
        await get().load()
        if (opts?.andPush) await get().push()
      },

      async push() {
        if (get().pushing) return false
        set({ pushing: true, pushed: null })
        clear('push')
        let ok = false
        try {
          const pushed = await client.push(worktree)
          set({ pushed, pushing: false })
          ok = true
        } catch (e) {
          set({ pushing: false })
          fail('push', e)
        }
        await get().load()
        if (ok && !get().pr) await get().findPr()
        return ok
      },

      openPr() {
        const base = get().status?.base ?? 'main'
        set({ prForm: { base, title: '', body: '', draft: false } })
        clear('pr')
        void get().draftPr()
      },

      closePr() {
        set({ prForm: null, drafting: false })
      },

      setPr(patch) {
        set((s) => (s.prForm ? { prForm: { ...s.prForm, ...patch } } : {}))
      },

      async draftPr() {
        const form = get().prForm
        if (!form || get().drafting) return
        set({ drafting: true })
        clear('pr')
        try {
          const draft = await client.draftPr(worktree, form.base.trim())
          set((s) => ({ drafting: false, prForm: s.prForm ? { ...s.prForm, title: draft.title, body: draft.body } : null }))
        } catch (e) {
          set({ drafting: false })
          fail('pr', e)
        }
      },

      async createPr() {
        const form = get().prForm
        if (!form || get().creating || !form.title.trim()) return
        set({ creating: true })
        clear('pr')
        const st = get().status
        if (!st?.published || st.ahead > 0) {
          if (!(await get().push())) {
            set({ creating: false })
            return
          }
          // The push found the branch's PR: nothing to create.
          if (get().pr?.state === 'OPEN') {
            set({ prForm: null, creating: false })
            return
          }
        }
        try {
          const pr = await client.createPr(worktree, { base: form.base.trim(), title: form.title.trim(), body: form.body, draft: form.draft })
          set({ pr, prForm: null, creating: false })
        } catch (e) {
          set({ creating: false })
          fail('pr', e)
        }
      },

      dismiss(step) {
        clear(step)
      },
    }
  })
}

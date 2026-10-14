import { createContext, useContext, useEffect } from 'react'
import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { tauriAccounts, type AccountsClient } from './client'
import { createFollow, type FollowDeps } from './follow'
import { appFollow } from './follow-app'
import type { Account, AccountsState, PlanUsage } from './types'
import { afterStartup } from '../shell/after-startup'
import { pollWhileShown } from '../shell/while-shown'

/** How often every account's usage is read again while the app is open. */
export const POLL_MS = 5 * 60_000
/** What the terminal a new account opens in types: Claude Code, which asks a fresh config dir to log in. */
export const LOGIN_CMD = 'claude'

/** One account's usage as last read. `usage` stays while a new reading is fetched (`loading`), and
 *  when one fails (`error`, in a sentence). */
export type Usage = { usage: PlanUsage | null; error: string | null; loading: boolean }

export type Accounts = {
  /** Null until the list is read (and for good when the app has no accounts commands). */
  state: AccountsState | null
  /** Why the list could not be read, while it cannot: new terminals then run on the default
   *  account whatever was chosen. Null once read, and when the app has no accounts commands. */
  listError: string | null
  usage: Record<string, Usage>
  /** The account each terminal pane was spawned on. A pane missing here was spawned after the last
   *  switch, so it runs on the active account. */
  panes: Record<number, string>
  /** What the last add, rename, remove, share or switch said when it failed, or a session that
   *  followed a switch but could not be recorded on its new account. */
  error: string | null
  /** What the last share left to say: where the copies that differed were kept. */
  note: string | null
  /** Reads the list, the panes and the usage, follows `accounts://changed` and polls the usage.
   *  Once: later calls do nothing. */
  start(): void
  /** Reads the list again after it could not be read (`listError`), and starts what `start`
   *  could not. Nothing once the list is known. */
  retryList(): Promise<void>
  /** Reads every account's usage. `refresh`: past the reading kept from under a minute ago. */
  readUsage(refresh: boolean): Promise<void>
  switchTo(id: string): Promise<void>
  /** Adds an account named `label` and opens a terminal on it, where Claude Code asks it to log in.
   *  The active account stays the one it was. Null when adding failed (`error` says why). */
  add(label: string): Promise<Account | null>
  rename(id: string, label: string): Promise<boolean>
  remove(id: string): Promise<boolean>
  /** Puts back what account `id` holds of its own in place of the default account's. */
  share(id: string): Promise<boolean>
  clearError(): void
  clearNote(): void
}

export type AccountsStore = StoreApi<Accounts>

/** What moving the open sessions on a switch needs from the rest of the app (`follow.ts`); the
 *  accounts themselves come from the store. */
export type FollowEnv = Omit<FollowDeps, 'paneAccounts' | 'target' | 'record'>

const say = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** No accounts commands to ask: a backend without them refuses with `command … not found`, and
 *  outside Tauri (a test, a page with no IPC) `invoke` throws an `Error`. Nothing to show then,
 *  and nothing went wrong. A command that ran and failed refuses with its `Err`, a string. */
const noCommands = (e: unknown) => typeof e !== 'string' || /^command \S+ not found$/.test(e)

/** `follow`: open Claude sessions follow a switch (decision 9). None given: they stay.
 *  `firstUsage`: what the first plan-usage read waits for; none given, nothing. */
export function createAccountsStore(
  client: AccountsClient,
  opts: { pollMs?: number; follow?: FollowEnv; firstUsage?: () => Promise<void> } = {},
): AccountsStore {
  return createZustand<Accounts>((set, get) => {
    let started = false
    /** The active account the open sessions were last sent to; null until the list is read. */
    let followed: string | null = null
    /** An add under way switches to the new account for its login terminal and back: the
     *  sessions stay put meanwhile. */
    let adding = 0
    const follow =
      opts.follow &&
      createFollow({
        ...opts.follow,
        paneAccounts: () => client.panes(),
        target: () => {
          const s = get().state
          return s?.accounts.find((a) => a.id === s.active) ?? null
        },
        record: async (pane, id) => {
          try {
            await client.movePane(pane, id)
          } catch (e) {
            const label = get().state?.accounts.find((a) => a.id === id)?.label ?? id
            set({ error: `A session moved to ${label}, but the app could not record it: ${say(e)}` })
            throw e
          } finally {
            void readPanes()
          }
        },
      })
    /** The newest usage request per account: an older answer landing after it is dropped. */
    const asked: Record<string, number> = {}
    let seq = 0

    function apply(state: AccountsState) {
      const ids = new Set(state.accounts.map((a) => a.id))
      const usage = Object.fromEntries(Object.entries(get().usage).filter(([id]) => ids.has(id)))
      set({ state, usage })
      if (adding) return
      const was = followed
      followed = state.active
      if (was !== null && was !== state.active) void follow?.switched().catch(() => {})
    }

    async function readPanes() {
      try {
        set({ panes: (await client.panes()) ?? {} })
      } catch {
        // Without it, no pane says which account it runs on: nothing else depends on it.
      }
    }

    async function readOne(a: Account, refresh: boolean) {
      const n = (asked[a.id] = ++seq)
      const was = get().usage[a.id]
      set((s) => ({ usage: { ...s.usage, [a.id]: { usage: was?.usage ?? null, error: was?.error ?? null, loading: true } } }))
      let next: Usage
      try {
        next = { usage: await client.usage(a, refresh), error: null, loading: false }
      } catch (e) {
        next = { usage: get().usage[a.id]?.usage ?? null, error: say(e), loading: false }
      }
      if (asked[a.id] !== n || !get().state?.accounts.some((x) => x.id === a.id)) return
      set((s) => ({ usage: { ...s.usage, [a.id]: next } }))
    }

    /** Runs `act`; a failure lands in `error` and answers `fallback`. */
    async function attempt<T>(act: () => Promise<T>, fallback: T): Promise<T> {
      set({ error: null, note: null })
      try {
        return await act()
      } catch (e) {
        set({ error: say(e) })
        return fallback
      }
    }

    /** The list read under way, so a retry pressed twice reads it once. */
    let reading: Promise<void> | null = null

    /** Reads the list; once it is known, the panes, the usage, the change event and the poll. */
    async function begin() {
      try {
        apply(await client.list())
      } catch (e) {
        set({ listError: noCommands(e) ? null : say(e) })
        return
      }
      set({ listError: null })
      if (!get().state) return
      void readPanes()
      void (opts.firstUsage?.() ?? Promise.resolve()).then(() => get().readUsage(false))
      try {
        await client.onChanged((state) => {
          apply(state)
          void readPanes()
          void get().readUsage(false)
        })
      } catch {
        // No event: the list still changes through this store's own actions.
      }
      pollWhileShown(() => get().readUsage(false), opts.pollMs ?? POLL_MS, { wait: true })
    }

    function readList() {
      reading ??= begin().finally(() => (reading = null))
      return reading
    }

    return {
      state: null,
      listError: null,
      usage: {},
      panes: {},
      error: null,
      note: null,

      start() {
        if (started) return
        started = true
        void readList()
      },

      async retryList() {
        if (get().state) return
        started = true
        await readList()
      },

      async readUsage(refresh) {
        await Promise.all((get().state?.accounts ?? []).map((a) => readOne(a, refresh)))
      },

      switchTo: (id) =>
        attempt(async () => {
          apply(await client.switchTo(id))
          void readPanes()
          await get().readUsage(true)
        }, undefined),

      add: (label) =>
        attempt(async () => {
          // Read before adding: accounts-core makes the new account active, and its
          // `accounts://changed` may land before `add` answers.
          const was = get().state?.active
          let account: Account
          adding++
          try {
            account = await client.add(label)
            // A pane runs on the account active when it spawns: switch for the spawn, then back.
            apply(await client.switchTo(account.id))
            try {
              await client.openTerminal(LOGIN_CMD)
            } finally {
              if (was && was !== account.id) apply(await client.switchTo(was))
            }
          } finally {
            adding--
            // The sessions stay where they were sent last, whatever the add left active.
            if (!adding) followed = get().state?.active ?? followed
          }
          void readPanes()
          void get().readUsage(false)
          return account
        }, null),

      rename: (id, label) =>
        attempt(async () => {
          apply(await client.rename(id, label))
          return true
        }, false),

      remove: (id) =>
        attempt(async () => {
          apply(await client.remove(id))
          return true
        }, false),

      share: (id) =>
        attempt(async () => {
          const { state, kept } = await client.share(id)
          apply(state)
          if (kept.length) set({ note: `Shared with the default account. What differed from the default account's was not merged and is kept in ${kept.join(', ')}.` })
          return true
        }, false),

      clearError: () => set({ error: null }),
      clearNote: () => set({ note: null }),
    }
  })
}

/** The app's accounts, on the Tauri commands; the open sessions follow a switch. */
export const accountsStore = createAccountsStore(tauriAccounts, { follow: appFollow, firstUsage: afterStartup })

/** The store the accounts UI reads: the app's, or a test's. */
export const AccountsContext = createContext<AccountsStore>(accountsStore)

/** Reads the accounts, starting the store the first time anything does. */
export function useAccounts<T>(pick: (s: Accounts) => T): T {
  const store = useContext(AccountsContext)
  useEffect(() => store.getState().start(), [store])
  return useStore(store, pick)
}

/** The store itself, for its actions. */
export const useAccountsStore = () => useContext(AccountsContext)

/** The account pane `id` runs on, when the pane should say it: there is more than one account and
 *  the pane's is not the active one. An account removed since reads by its id. */
export function usePaneAccount(id: number): string | null {
  return useAccounts((s) => {
    const of = s.panes[id]
    if (!s.state || s.state.accounts.length < 2 || !of || of === s.state.active) return null
    return s.state.accounts.find((a) => a.id === of)?.label ?? of
  })
}

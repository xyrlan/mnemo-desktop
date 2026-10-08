import type { AccountsClient } from './client'
import type { Account, AccountsState, PlanLimit, PlanUsage } from './types'

export const NOW = Date.parse('2026-10-07T20:00:00Z')

export const account = (id: string, more: Partial<Account> = {}): Account => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  configDir: id === 'default' ? '/Users/me/.claude' : `/Users/me/.claude-${id}`,
  isDefault: id === 'default',
  email: `${id}@example.com`,
  problem: null,
  ...more,
})

export const limit = (kind: string, percent: number, more: Partial<PlanLimit> = {}): PlanLimit => ({
  kind,
  group: kind.startsWith('weekly') ? 'weekly' : kind,
  model: null,
  percent,
  severity: 'normal',
  resetsAt: '2026-10-08T01:10:00Z',
  active: false,
  ...more,
})

export const reading = (limits: PlanLimit[], more: Partial<PlanUsage> = {}): PlanUsage => ({ limits, plan: 'max', fetchedAt: NOW - 30_000, stale: null, ...more })

/** A stand-in for the commands: answers from `state` and `usage`, and records every call (a plain
 *  recorder, not `vi.fn()`: memory vitest5-spy-rejecting-a-string-fails-the-test). A command in
 *  `refuse` rejects with its string, as a Tauri command returning `Err` does. */
export function fakeClient(init: { state: AccountsState; usage?: Record<string, PlanUsage | string>; panes?: Record<number, string> }) {
  const calls: [string, ...unknown[]][] = []
  const listeners: ((s: AccountsState) => void)[] = []
  const f = {
    state: init.state,
    usage: init.usage ?? {},
    panes: init.panes ?? {},
    refuse: {} as Record<string, string>,
    calls,
    /** Emits `accounts://changed`. */
    emit(state: AccountsState) {
      f.state = state
      for (const l of listeners) l(state)
    },
    called: (cmd: string) => calls.filter((c) => c[0] === cmd),
  }
  const answer = async <T>(cmd: string, args: unknown[], value: () => T): Promise<T> => {
    calls.push([cmd, ...args])
    if (f.refuse[cmd]) throw f.refuse[cmd]
    return value()
  }
  const client: AccountsClient = {
    list: () => answer('list', [], () => f.state),
    switchTo: (id) => answer('switch', [id], () => (f.state = { ...f.state, active: id })),
    add: (label) =>
      answer('add', [label], () => {
        const a = account(label.toLowerCase(), { label, email: null, problem: 'Not logged in yet.' })
        // As accounts-core does: the new account becomes the active one, and `accounts://changed`
        // says so before the command answers.
        f.emit({ active: a.id, accounts: [...f.state.accounts, a] })
        return a
      }),
    rename: (id, label) => answer('rename', [id, label], () => (f.state = { ...f.state, accounts: f.state.accounts.map((a) => (a.id === id ? { ...a, label } : a)) })),
    remove: (id) =>
      answer('remove', [id], () => (f.state = { active: f.state.active === id ? 'default' : f.state.active, accounts: f.state.accounts.filter((a) => a.id !== id) })),
    panes: () => answer('panes', [], () => f.panes),
    usage: (a, refresh) =>
      answer('usage', [a.id, refresh], () => {
        const u = f.usage[a.id]
        if (u === undefined) throw `No reading of ${a.label} yet.`
        if (typeof u === 'string') throw u
        return u
      }),
    onChanged: async (cb) => {
      listeners.push(cb)
      return () => void listeners.splice(listeners.indexOf(cb), 1)
    },
    openTerminal: (cmd) => answer('terminal', [cmd, f.state.active], () => undefined),
  }
  return { fake: f, client }
}

/** Lets every pending promise settle. */
export const settle = () => new Promise((r) => setTimeout(r, 0))

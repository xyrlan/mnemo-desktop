import type { AgentKind } from '../agent/kind'

/** A Claude Code or Grok Build account: a config dir with its own login (spec
 *  2026-10-07-claude-accounts, decision 1; 2026-10-16-grok-accounts, decisions 1 and 2). `kind`
 *  says which CLI runs on it, and a Grok account's `configDir` is its Grok home. The default account
 *  is always a Claude one. `problem` says what is wrong with it in a sentence, or is null.
 *  `unshared` names what it holds of its own where the default account's should be linked
 *  (`problem` says so too): sharing puts it back. A Grok account shares nothing. */
export type Account = { id: string; label: string; configDir: string; isDefault: boolean; kind: AgentKind; email: string | null; problem: string | null; unshared: string[] }
/** What sharing answers: the accounts now, and where each copy of the account's own that differed
 *  from the default account's was kept. */
export type Shared = { state: AccountsState; kept: string[] }
/** Every account, and the one panes opened from now on run in. */
export type AccountsState = { active: string; accounts: Account[] }

/** One limit of an account's plan, as the endpoint behind `/usage` gives it. `kind` and `severity`
 *  are the endpoint's own words: one the app does not know still shows. `model` names a scoped limit. */
export type PlanLimit = { kind: string; group: string; model: string | null; percent: number; severity: string; resetsAt: string | null; active: boolean }
/** An account's plan usage. `stale` says, in a sentence, why this is an old reading; `fetchedAt`
 *  (unix ms) is when it was read. */
export type PlanUsage = { limits: PlanLimit[]; plan: string | null; fetchedAt: number; stale: string | null }

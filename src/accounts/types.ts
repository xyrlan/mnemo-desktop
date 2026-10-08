/** A Claude Code account: a config dir with its own login (spec 2026-10-07-claude-accounts, decision 1).
 *  `problem` says what is wrong with it in a sentence, or is null. */
export type Account = { id: string; label: string; configDir: string; isDefault: boolean; email: string | null; problem: string | null }
/** Every account, and the one panes opened from now on run in. */
export type AccountsState = { active: string; accounts: Account[] }

/** One limit of an account's plan, as the endpoint behind `/usage` gives it. `kind` and `severity`
 *  are the endpoint's own words: one the app does not know still shows. `model` names a scoped limit. */
export type PlanLimit = { kind: string; group: string; model: string | null; percent: number; severity: string; resetsAt: string | null; active: boolean }
/** An account's plan usage. `stale` says, in a sentence, why this is an old reading; `fetchedAt`
 *  (unix ms) is when it was read. */
export type PlanUsage = { limits: PlanLimit[]; plan: string | null; fetchedAt: number; stale: string | null }

/** The account a background session runs on, and the command that reaches it there (spec
 *  `2026-10-07-claude-accounts-design.md`, decisions 1 and 5; `2026-10-16-grok-accounts-design.md`,
 *  decisions 3 and 6). A pane runs with the variables of the account that was active when it was
 *  spawned, so a `claude attach`, `claude stop` or `claude --resume` typed into it would reach that
 *  account's daemon, and a `grok` that account's home. A command for a session on another account
 *  carries the session's own account in front of it: its kind's variable (`CLAUDE_CONFIG_DIR` or
 *  `GROK_HOME`, set or unset) and `MNEMO_AGENT`, so mnemo in it runs the session's CLI. */

import { AGENT_ENV_VAR, HOME_VAR, kindOf, type AgentKind } from '../agent/kind'
import type { Account } from '../accounts/types'
import { paneShell, shellWord, withEnv, type Shell } from '../pty/typed'

/** Mirrors `account_dirs::AccountEnv`: `config_dir` null runs with the kind's variable unset: the
 *  default account, never `CLAUDE_CONFIG_DIR=~/.claude` (Claude Code reads that as another login),
 *  and the Grok account at `~/.grok`. Every row the app reads carries `kind`; one without (a row
 *  written before Grok accounts) is a Claude one, typed as it was then: its config dir alone. */
export type AccountEnv = { config_dir: string | null; kind?: AgentKind }

/** A row that knows its account: a `ChildSession`, a `HomeSession`. `account_env` is null while
 *  there is only the default account, and the command is typed as it always was. */
export type OnAccount = { account?: string | null; account_env?: AccountEnv | null }

export const CONFIG_DIR_VAR = 'CLAUDE_CONFIG_DIR'

export { shellWord }

/** A variable `withEnvs` sets, or unsets when its value is null. */
export type EnvVar = readonly [name: string, value: string | null]

/** `s` where cmd reads it outside quotes: each character cmd would act on gets its caret
 *  (`cmdBare` in `pty/typed.ts`). */
const cmdBare = (s: string) => s.replace(/[\^&|<>()]/g, '^$&')

/** `withEnv` for several variables, in the order given; one variable is typed exactly as
 *  `withEnv` types it.
 *  - POSIX: one `env`, the unset ones first (`-u` is an option, read before any `NAME=value`).
 *  - cmd: one second cmd that runs a `set "NAME=value"` for each, joined by `&` as `withEnv`'s
 *    one is: each value sits where `withEnv`'s does, outside the pane's cmd's quotes, hence the
 *    carets.
 *  - PowerShell: each variable kept in its own `$mnemoWas…` and put back afterwards. */
export function withEnvs(cmd: string, vars: readonly EnvVar[], shell: Shell): string {
  if (vars.length === 0) return cmd
  switch (shell) {
    case 'posix': {
      const unset = vars.filter(([, v]) => v === null).map(([n]) => `-u ${n}`)
      const set = vars.flatMap(([n, v]) => (v === null ? [] : [`${n}=${shellWord(v)}`]))
      return `env ${[...unset, ...set].join(' ')} ${cmd}`
    }
    case 'cmd':
      return `cmd /d /s /c "${vars.map(([n, v]) => `set "${n}=${cmdBare(v ?? '')}"& `).join('')}${cmd}"`
    case 'powershell': {
      const was = (i: number) => `$mnemoWas${i === 0 ? '' : i}`
      const keep = vars.map(([n], i) => `${was(i)} = $env:${n}; `).join('')
      const put = vars.map(([n, v]) => `$env:${n} = ${v === null ? '$null' : `'${v.replace(/'/g, "''")}'`}; `).join('')
      const back = vars.map(([n], i) => `$env:${n} = ${was(i)}`).join('; ')
      return `${keep}${put}try { ${cmd} } finally { ${back} }`
    }
  }
}

/** The variables a command on `env`'s account runs with: `MNEMO_AGENT`, then the kind's own. */
export function accountVars(env: AccountEnv & { kind: AgentKind }): EnvVar[] {
  return [
    [AGENT_ENV_VAR, env.kind],
    [HOME_VAR[env.kind], env.config_dir],
  ]
}

/** `cmd` as it must be typed into a pane's shell to run on `s`'s account, the pane's shell left
 *  as it was (`withEnvs` has each shell's way). `shell` is the shell of a pane the app just
 *  spawned unless the caller read another off the pane. */
export function onAccount(cmd: string, s: OnAccount | null | undefined, shell: Shell = paneShell()): string {
  const env = s?.account_env
  if (!env) return cmd
  if (!env.kind) return withEnv(cmd, CONFIG_DIR_VAR, env.config_dir, shell)
  return withEnvs(cmd, accountVars({ ...env, kind: env.kind }), shell)
}

/** What a command needs to run on `a`, as `account_dirs::Account::env` gives a row's: its dir in
 *  the kind's variable, or that variable unset for the default account and for the Grok account
 *  whose dir is Grok's own default, named `.grok` (`account_dirs::Account::runs_unset`). */
export function envOfAccount(a: Pick<Account, 'configDir' | 'isDefault' | 'kind'>): AccountEnv & { kind: AgentKind } {
  const kind = kindOf(a.kind)
  const unset = kind === 'grok' ? a.configDir.split(/[\\/]/).pop() === '.grok' : a.isDefault
  return { config_dir: unset ? null : a.configDir, kind }
}

/** The kind of CLI `s` runs on: Claude for a row that does not say. */
export const kindOfRow = (s: OnAccount | null | undefined): AgentKind => s?.account_env?.kind ?? 'claude'

/** The session opened in a pane on its own account. Claude: `claude attach <id>`. Grok: the TUI
 *  resumed on it in leader mode (`--leader`, hidden in `grok --help` but read from
 *  `xai-grok-pager/src/app/cli.rs` and parsed by grok 1.0.60), so the pane is one more client of the
 *  session the leader holds. `-r` takes a session id from any directory; a Grok row's `id` is the
 *  session's id. */
export const attachCmd = (s: { id: string } & OnAccount, shell?: Shell) =>
  onAccount(kindOfRow(s) === 'grok' ? `grok --leader -r ${s.id}` : `claude attach ${s.id}`, s, shell)

/** The session stopped on its own account. Claude: `claude stop <id>`. Grok: `mnemo grok close
 *  <id>`, which reaches the leader of the home in `GROK_HOME`, so the account's own variable is
 *  its `--home` (and `~/.grok`'s, unset, is mnemo's default) with no path to quote for each shell. */
export const stopCmd = (s: { id: string } & OnAccount, shell?: Shell) =>
  onAccount(kindOfRow(s) === 'grok' ? `mnemo grok close ${s.id}` : `claude stop ${s.id}`, s, shell)

/** A session named by its id alone (a test, an older caller), or a row that knows its account. */
export type Target = string | ({ id: string } & OnAccount)
export const idOf = (t: Target) => (typeof t === 'string' ? t : t.id)
export const accountOf = (t: Target): OnAccount | null => (typeof t === 'string' ? null : t)

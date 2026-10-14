/** The account a background session runs on, and the command that reaches it there (spec
 *  `2026-10-07-claude-accounts-design.md`, decisions 1 and 5). A pane runs with the
 *  `CLAUDE_CONFIG_DIR` of the account that was active when it was spawned, so a `claude attach`,
 *  `claude stop` or `claude --resume` typed into it would reach that account's daemon. A command
 *  for a session on another account carries the session's own account in front of it. */

import { paneShell, shellWord, withEnv, type Shell } from '../pty/typed'

/** Mirrors `account_dirs::AccountEnv`: `config_dir` null is the default account, which runs with
 *  `CLAUDE_CONFIG_DIR` unset, never set to `~/.claude` (Claude Code reads that as another login). */
export type AccountEnv = { config_dir: string | null }

/** A row that knows its account: a `ChildSession`, a `HomeSession`. `account_env` is null while
 *  there is only the default account, and the command is typed as it always was. */
export type OnAccount = { account?: string | null; account_env?: AccountEnv | null }

export const CONFIG_DIR_VAR = 'CLAUDE_CONFIG_DIR'

export { shellWord }

/** `cmd` as it must be typed into a pane's shell to run on `s`'s account, the pane's shell left
 *  as it was (`withEnv` has each shell's way). `shell` is the shell of a pane the app just
 *  spawned unless the caller read another off the pane. */
export function onAccount(cmd: string, s: OnAccount | null | undefined, shell: Shell = paneShell()): string {
  const env = s?.account_env
  if (!env) return cmd
  return withEnv(cmd, CONFIG_DIR_VAR, env.config_dir, shell)
}

/** `claude attach <id>` on the session's own account. */
export const attachCmd = (s: { id: string } & OnAccount, shell?: Shell) => onAccount(`claude attach ${s.id}`, s, shell)
/** `claude stop <id>` on the session's own account. */
export const stopCmd = (s: { id: string } & OnAccount, shell?: Shell) => onAccount(`claude stop ${s.id}`, s, shell)

/** A session named by its id alone (a test, an older caller), or a row that knows its account. */
export type Target = string | ({ id: string } & OnAccount)
export const idOf = (t: Target) => (typeof t === 'string' ? t : t.id)
export const accountOf = (t: Target): OnAccount | null => (typeof t === 'string' ? null : t)

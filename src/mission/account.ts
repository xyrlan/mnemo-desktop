/** The account a background session runs on, and the command that reaches it there (spec
 *  `2026-10-07-claude-accounts-design.md`, decisions 1 and 5). A pane runs with the
 *  `CLAUDE_CONFIG_DIR` of the account that was active when it was spawned, so a `claude attach`,
 *  `claude stop` or `claude --resume` typed into it would reach that account's daemon. A command
 *  for a session on another account carries the session's own account in front of it. */

/** Mirrors `account_dirs::AccountEnv`: `config_dir` null is the default account, which runs with
 *  `CLAUDE_CONFIG_DIR` unset, never set to `~/.claude` (Claude Code reads that as another login). */
export type AccountEnv = { config_dir: string | null }

/** A row that knows its account: a `ChildSession`, a `HomeSession`. `account_env` is null while
 *  there is only the default account, and the command is typed as it always was. */
export type OnAccount = { account?: string | null; account_env?: AccountEnv | null }

export const CONFIG_DIR_VAR = 'CLAUDE_CONFIG_DIR'

/** `s` as one POSIX shell word: bare when it is only safe characters, else single-quoted. */
export function shellWord(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/** `cmd` as it must be typed into a shell to run on `s`'s account. `env` rather than a bare
 *  assignment so it reads the same in zsh, bash and fish, and leaves the pane's shell as it was. */
export function onAccount(cmd: string, s: OnAccount | null | undefined): string {
  const env = s?.account_env
  if (!env) return cmd
  return env.config_dir === null ? `env -u ${CONFIG_DIR_VAR} ${cmd}` : `env ${CONFIG_DIR_VAR}=${shellWord(env.config_dir)} ${cmd}`
}

/** `claude attach <id>` on the session's own account. */
export const attachCmd = (s: { id: string } & OnAccount) => onAccount(`claude attach ${s.id}`, s)
/** `claude stop <id>` on the session's own account. */
export const stopCmd = (s: { id: string } & OnAccount) => onAccount(`claude stop ${s.id}`, s)

/** A session named by its id alone (a test, an older caller), or a row that knows its account. */
export type Target = string | ({ id: string } & OnAccount)
export const idOf = (t: Target) => (typeof t === 'string' ? t : t.id)
export const accountOf = (t: Target): OnAccount | null => (typeof t === 'string' ? null : t)

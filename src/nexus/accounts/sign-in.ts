import { LOGIN_CMD } from '../../accounts/store'
import type { Account } from '../../accounts/types'
import { onAccount } from '../../mission/account'
import type { Shell } from '../../pty/typed'

/** What a terminal types to sign in to `account` again, whichever account is active: Claude Code on
 *  that account's folder, which asks a folder with no login to log in (`/login` does it for one that
 *  has one). The default account runs with `CLAUDE_CONFIG_DIR` unset, never set to `~/.claude`,
 *  which Claude Code would read as another login. */
export function signInCommand(account: Pick<Account, 'configDir' | 'isDefault'>, shell?: Shell): string {
  return onAccount(LOGIN_CMD, { account_env: { config_dir: account.isDefault ? null : account.configDir } }, shell)
}

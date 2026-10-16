import { loginCommand } from '../../accounts/store'
import type { Account } from '../../accounts/types'
import { envOfAccount, onAccount } from '../../mission/account'
import type { Shell } from '../../pty/typed'

/** What a terminal types to sign in to `account` again, whichever account is active: its CLI's
 *  sign-in on that account's folder. Claude Code asks a folder with no login to log in (`/login`
 *  does it for one that has one); Grok's is `grok login`. The default account runs with
 *  `CLAUDE_CONFIG_DIR` unset, never set to `~/.claude`, which Claude Code would read as another
 *  login, and the Grok account at `~/.grok` with `GROK_HOME` unset. `MNEMO_AGENT` says the kind, so
 *  a Claude sign-in in a terminal spawned on a Grok account is still a Claude session to mnemo. */
export function signInCommand(account: Pick<Account, 'configDir' | 'isDefault' | 'kind'>, shell?: Shell): string {
  const env = envOfAccount(account)
  return onAccount(loginCommand(env.kind), { account_env: env }, shell)
}

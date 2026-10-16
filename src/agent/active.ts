/** The active account as the code that starts a CLI needs it: its kind, and the dir in that kind's
 *  variable (`envOfAccount`), as a pane spawned now runs with them (`pty.rs`, `on_account`). */

import { accountsStore } from '../accounts/store'
import type { AccountsState } from '../accounts/types'
import { envOfAccount, type AccountEnv } from '../mission/account'
import type { AgentKind } from './kind'

/** An account's CLI and where it keeps its sessions. */
export type Agent = AccountEnv & { kind: AgentKind }

/** The default account's: Claude, with `CLAUDE_CONFIG_DIR` unset. */
export const DEFAULT_AGENT: Agent = { config_dir: null, kind: 'claude' }

/** The active account's agent; the default account's while the list is unread, or names no account
 *  it has (a new pane then runs on the default account too). */
export function activeAgent(state: AccountsState | null = accountsStore.getState().state): Agent {
  const a = state?.accounts.find((x) => x.id === state.active)
  return a ? envOfAccount(a) : DEFAULT_AGENT
}

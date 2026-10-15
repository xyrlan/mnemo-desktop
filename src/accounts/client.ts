import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { store as layout } from '../layout/app-store'
import { nexusRoutes } from '../nexus/outside'
import type { Account, AccountsState, PlanUsage, Shared } from './types'

export const CHANGED_EVENT = 'accounts://changed'

/** Everything the accounts UI asks of the rest of the app: the `accounts_*` and `plan_usage`
 *  commands, the change event, and a terminal to log in from. */
export interface AccountsClient {
  list(): Promise<AccountsState>
  switchTo(id: string): Promise<AccountsState>
  add(label: string): Promise<Account>
  rename(id: string, label: string): Promise<AccountsState>
  remove(id: string): Promise<AccountsState>
  /** Puts back what account `id` holds of its own in place of the default account's. */
  share(id: string): Promise<Shared>
  /** The account each terminal pane was spawned on, by pane id. */
  panes(): Promise<Record<number, string>>
  /** Records that pane `pane`'s session moved to account `id` (its shell was moved there). */
  movePane(pane: number, id: string): Promise<void>
  usage(account: Account, refresh: boolean): Promise<PlanUsage>
  /** Calls `cb` with every new state; resolves to the unsubscribe. */
  onChanged(cb: (state: AccountsState) => void): Promise<() => void>
  /** Opens a terminal that runs `cmd`, spawned on whichever account is active now: a workbench tab,
   *  or a drawer tab while the Nexus covers the workbench. */
  openTerminal(cmd: string): Promise<void>
}

export const tauriAccounts: AccountsClient = {
  list: () => invoke<AccountsState>('accounts_list'),
  switchTo: (id) => invoke<AccountsState>('accounts_switch', { id }),
  add: (label) => invoke<Account>('accounts_add', { label }),
  rename: (id, label) => invoke<AccountsState>('accounts_rename', { id, label }),
  remove: (id) => invoke<AccountsState>('accounts_remove', { id }),
  share: (id) => invoke<Shared>('accounts_share', { id }),
  panes: () => invoke<Record<number, string>>('accounts_panes'),
  movePane: (pane, id) => invoke<void>('accounts_move_pane', { pane, id }),
  usage: (a, refresh) => invoke<PlanUsage>('plan_usage', { configDir: a.configDir, isDefault: a.isDefault, refresh }),
  onChanged: (cb) => listen<AccountsState>(CHANGED_EVENT, (e) => cb(e.payload)),
  openTerminal: (cmd) => nexusRoutes()?.terminal(undefined, cmd, 'Sign in') ?? layout.getState().openCommandTab(undefined, cmd),
}

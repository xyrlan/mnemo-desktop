import { useEffect, useState, type JSX } from 'react'
import { useAccounts, useAccountsStore } from '../../../accounts/store'
import { AccountsList, useNow } from '../../accounts/AccountsList'
import { registerWindow } from '../../ui/windows'

/** SYSTEMS › Accounts (spec `2026-10-15-nexus-app-design.md`, Q8): every Claude account with its
 *  usage; add, rename, sign in again, share and remove (confirmed), as the accounts panel does them.
 *  Opened, it reads every account's usage again. A sign-in terminal opens in the drawer, and the
 *  window gives way to it. */
export function AccountsWindow({ close }: { close: () => void }): JSX.Element {
  const store = useAccountsStore()
  const known = useAccounts((s) => s.state !== null)
  const listError = useAccounts((s) => s.listError)
  const [trying, setTrying] = useState(false)
  const now = useNow()
  // Opened, every account's usage is read again, as the switcher's click does.
  useEffect(() => void store.getState().readUsage(true), [store, known])
  return (
    <div data-nx-accounts-window="">
      {!known && !listError && <p className="nx-muted">Reading the accounts…</p>}
      {!known && listError && (
        <div role="alert" className="nx-acct-say" data-tone="danger">
          <span>
            The Claude accounts list could not be read: {listError}. Until it can, new sessions run on the default account.
          </span>
          <button
            type="button"
            className="nx-btn"
            disabled={trying}
            onClick={() => {
              setTrying(true)
              void store
                .getState()
                .retryList()
                .finally(() => setTrying(false))
            }}
          >
            Retry
          </button>
        </div>
      )}
      <AccountsList now={now} onTerminal={close} />
    </div>
  )
}

registerWindow({ id: 'accounts', title: 'Accounts', group: 'systems', order: 40, width: 560, render: (_params, close) => <AccountsWindow close={close} /> })

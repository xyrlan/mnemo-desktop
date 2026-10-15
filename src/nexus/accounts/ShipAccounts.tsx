import type { JSX } from 'react'
import { AccountSwitcher } from '../../accounts/AccountSwitcher'

/** The account switcher in the ship's bar. `portal`: the dark layer its popover opens in. Until the
 *  round's `config` piece gives it the ship's look (spec `2026-10-15-nexus-app-design.md`, Q8), it
 *  is the sidebar's switcher in the app's dark tokens. */
export function ShipAccounts({ portal }: { portal: HTMLElement | null }): JSX.Element {
  return (
    <div className="ship-accounts dark font-sans">
      <AccountSwitcher className="w-full" portal={portal} />
    </div>
  )
}

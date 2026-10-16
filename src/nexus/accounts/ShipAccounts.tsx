import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { limitName, percentNow, resetsWhen, tightest } from '../../accounts/format'
import { useAccounts, useAccountsStore } from '../../accounts/store'
import '../ui/ui.css'
import { AccountsList, Bar, useNow } from './AccountsList'
import './accounts.css'

/** In place of the switcher while the accounts list cannot be read: why, what it means for a new
 *  session, and a retry. */
function Unreadable({ why }: { why: string }) {
  const store = useAccountsStore()
  const [trying, setTrying] = useState(false)
  return (
    <div
      role="alert"
      className="nx-switch-error"
      title={`The Claude accounts list could not be read: ${why}\nUntil it can, new sessions run on the default account.`}
      data-account-switcher-error=""
    >
      <span>▲ Accounts unreadable</span>
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
  )
}

/** The account switcher in the ship's bar, in the ship's look: the active account and its tightest
 *  limit. A click opens every account (`AccountsList`) under it, in `portal` (the ship's layer at the
 *  end of `<body>`, `<body>` if none), and reads every account's usage again. Esc and a click outside
 *  close it. Draws nothing until the accounts are known, unless they could not be read. A failure
 *  the accounts show marks the switcher, so it is seen with them closed. */
export function ShipAccounts({ portal }: { portal: HTMLElement | null }): JSX.Element {
  const store = useAccountsStore()
  const state = useAccounts((s) => s.state)
  const listError = useAccounts((s) => s.listError)
  const error = useAccounts((s) => s.error)
  const usage = useAccounts((s) => (s.state ? s.usage[s.state.active] : undefined))
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const now = useNow()
  const open = at !== null

  const show = () => {
    const r = button.current!.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 348)), top: r.bottom + 4 })
    void store.getState().readUsage(true)
  }

  useEffect(() => {
    if (!open) return
    // On `document`, in the capture phase: before the Nexus's own Esc, and after a name being typed
    // (or a confirmation) has caught its own on `window`.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setAt(null)
      button.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setAt(null)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  const account = state?.accounts.find((a) => a.id === state.active)
  const label = account?.label ?? state?.active ?? ''
  const limit = usage?.usage ? tightest(usage.usage.limits, now) : undefined
  const percent = limit ? percentNow(limit, now) : null
  const resets = limit ? resetsWhen(limit.resetsAt, now) : null
  const warn = account?.problem ?? error
  const cli = account?.kind === 'grok' ? 'Grok' : 'Claude'
  const title = [
    `${cli} account: ${label}${account?.email ? ` (${account.email})` : ''}`,
    limit && `${limitName(limit)} ${percent}%${resets && resets !== 'reset' ? `, resets ${resets}` : ''}`,
    usage?.usage?.stale && `Old reading: ${usage.usage.stale}`,
    account?.problem,
    error,
  ]
    .filter(Boolean)
    .join('\n')

  // `data-state="open"` on the accounts: the Nexus's own keys (Tab, `/`) wait while a dialog is open.
  return (
    <div className="ship-accounts nx">
      {!state ? (
        listError && <Unreadable why={listError} />
      ) : (
        <button
          ref={button}
          type="button"
          className="nx-switch"
          aria-label={`${cli} accounts: ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          data-account-switcher=""
          onClick={() => (open ? setAt(null) : show())}
        >
          <span className="nx-switch-name">{label}</span>
          {warn && (
            <span className="nx-switch-warn" aria-label={warn}>
              ▲
            </span>
          )}
          <span className="nx-switch-use" data-stale={usage?.usage?.stale ? '' : undefined}>
            {limit && percent !== null && (
              <>
                <Bar percent={percent} severity={limit.severity} label={`${limitName(limit)}: ${percent}%`} />
                {percent}%
              </>
            )}
            <span aria-hidden>▾</span>
          </span>
        </button>
      )}
      {state &&
        at &&
        createPortal(
          <div ref={pop} className="nx nx-pop" role="dialog" aria-label="Claude accounts" style={at} data-state="open" data-nx-accounts="">
            <AccountsList now={now} onTerminal={() => setAt(null)} />
          </div>,
          portal ?? document.body,
        )}
    </div>
  )
}

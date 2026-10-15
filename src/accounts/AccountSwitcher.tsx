import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronsUpDown, RefreshCw, UserRound } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { useAccounts, useAccountsStore } from './store'
import { limitName, percentNow, resetsWhen, tightest } from './format'
import { LimitBar } from './Usage'
import { AccountsPanel } from './AccountsPanel'

/** The time, again every 30 s: resets and ages read from it. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** In place of the switcher while the accounts list cannot be read: why, what it means for a new
 *  terminal, and a retry. */
function Unreadable({ why, className }: { why: string; className: string }) {
  const store = useAccountsStore()
  const [trying, setTrying] = useState(false)
  return (
    <div
      role="alert"
      className={cn('flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-xs', className)}
      title={`The Claude accounts list could not be read: ${why}\nUntil it can, new terminals run on the default account.`}
      data-account-switcher-error=""
    >
      <AlertTriangle className="size-3.5 shrink-0 text-status-warning" strokeWidth={2.25} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">Accounts unreadable</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="shrink-0"
        disabled={trying}
        onClick={() => {
          setTrying(true)
          void store
            .getState()
            .retryList()
            .finally(() => setTrying(false))
        }}
      >
        <RefreshCw className="size-3" aria-hidden />
        Retry
      </Button>
    </div>
  )
}

/** The account row, at the left sidebar's top and in the Nexus's bar: the active account's label and
 *  its tightest limit. A click opens the accounts (`AccountsPanel`), and reads every account's usage
 *  again. Draws nothing until the accounts are known, unless they could not be read (`Unreadable`).
 *  A failure the panel shows marks the row, so it is seen with the panel closed. `className`: where
 *  it sits, in place of the sidebar's margins. `portal`: where the accounts open, `<body>` if none. */
export function AccountSwitcher({ className = 'mx-2 mt-2', portal }: { className?: string; portal?: HTMLElement | null } = {}) {
  const store = useAccountsStore()
  const state = useAccounts((s) => s.state)
  const listError = useAccounts((s) => s.listError)
  const error = useAccounts((s) => s.error)
  const usage = useAccounts((s) => (s.state ? s.usage[s.state.active] : undefined))
  const [open, setOpen] = useState(false)
  const now = useNow()
  if (!state) return listError ? <Unreadable why={listError} className={className} /> : null
  const account = state.accounts.find((a) => a.id === state.active)
  const label = account?.label ?? state.active
  const limit = usage?.usage ? tightest(usage.usage.limits, now) : undefined
  const percent = limit ? percentNow(limit, now) : null
  const resets = limit ? resetsWhen(limit.resetsAt, now) : null
  const title = [
    `Claude account: ${label}${account?.email ? ` (${account.email})` : ''}`,
    limit && `${limitName(limit)} ${percent}%${resets && resets !== 'reset' ? `, resets ${resets}` : ''}`,
    usage?.usage?.stale && `Old reading: ${usage.usage.stale}`,
    account?.problem,
    error,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void store.getState().readUsage(true)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent',
            className,
          )}
          aria-label={`Claude accounts: ${label}`}
          title={title}
          data-account-switcher=""
        >
          <UserRound className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.25} aria-hidden />
          <span className="min-w-0 truncate text-xs font-semibold text-foreground/90">{label}</span>
          {(account?.problem || error) && <span className="size-1.5 shrink-0 rounded-full bg-status-warning" aria-label={error ?? account?.problem ?? undefined} />}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {limit && percent !== null && (
              <>
                <LimitBar className="w-10" percent={percent} severity={limit.severity} label={`${limitName(limit)}: ${percent}%`} />
                <span className={`text-[11px] tabular-nums ${usage?.usage?.stale ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>{percent}%</span>
              </>
            )}
            <ChevronsUpDown className="size-3 text-muted-foreground/70" aria-hidden />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="max-h-[70vh] w-80 overflow-y-auto p-0"
        portalContainer={portal}
        aria-label="Claude accounts"
        onEscapeKeyDown={(e) => {
          // Escape in a name being typed cancels the typing, not the whole list.
          if (document.activeElement instanceof HTMLInputElement) e.preventDefault()
        }}
      >
        <AccountsPanel now={now} onAdded={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

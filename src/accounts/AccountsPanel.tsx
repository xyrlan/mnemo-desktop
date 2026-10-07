import { useState } from 'react'
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button, Input } from '@/ui'
import { cn } from '@/ui/cn'
import { useAccounts, useAccountsStore, type Usage } from './store'
import { age } from './format'
import { LimitRow } from './Usage'
import type { Account } from './types'

/** Inline text entry: Enter saves, Escape cancels. */
function LabelInput({ initial, placeholder, submit, onSave, onCancel }: { initial: string; placeholder: string; submit: string; onSave(label: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial)
  const label = value.trim()
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (label) onSave(label)
      }}
    >
      <Input
        autoFocus
        className="h-7 px-2 text-xs md:text-xs"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <Button type="submit" size="xs" disabled={!label}>
        {submit}
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel" onClick={onCancel}>
        <X />
      </Button>
    </form>
  )
}

/** What an account's usage reads: every limit, or why there is none, and how old an old reading is. */
function AccountUsage({ entry, now }: { entry: Usage | undefined; now: number }) {
  const usage = entry?.usage
  if (!usage) {
    if (entry?.error) return <p className="text-[11px] leading-snug text-muted-foreground">No usage: {entry.error}</p>
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Reading usage…
      </p>
    )
  }
  return (
    <>
      {usage.limits.length ? (
        <ul className="flex flex-col gap-2">
          {usage.limits.map((l, i) => (
            <LimitRow key={`${l.kind}-${l.model ?? ''}-${i}`} limit={l} now={now} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">No limits in this plan's reading.</p>
      )}
      {usage.stale && (
        <p className="text-[11px] leading-snug text-muted-foreground" data-stale="">
          Read {age(usage.fetchedAt, now)}: {usage.stale}
        </p>
      )}
      {!usage.stale && entry?.error && <p className="text-[11px] leading-snug text-muted-foreground">Read {age(usage.fetchedAt, now)}; the last try failed: {entry.error}</p>}
    </>
  )
}

type Editing = { kind: 'rename' | 'remove'; id: string } | null

function AccountCard({ account, active, entry, now, editing, setEditing }: { account: Account; active: boolean; entry: Usage | undefined; now: number; editing: Editing; setEditing(e: Editing): void }) {
  const store = useAccountsStore()
  const renaming = editing?.kind === 'rename' && editing.id === account.id
  const removing = editing?.kind === 'remove' && editing.id === account.id
  const plan = entry?.usage?.plan
  return (
    <li className={cn('flex flex-col gap-2 rounded-md border px-2.5 py-2', active ? 'border-ring/60 bg-accent/40' : 'border-border')} data-account={account.id} aria-current={active || undefined}>
      {renaming ? (
        <LabelInput
          initial={account.label}
          placeholder="Account name"
          submit="Save"
          onCancel={() => setEditing(null)}
          onSave={async (label) => {
            if (await store.getState().rename(account.id, label)) setEditing(null)
          }}
        />
      ) : (
        <div className="flex min-w-0 items-start gap-1">
          <button
            type="button"
            className={cn('flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50', !active && 'cursor-pointer')}
            title={active ? 'Panes you open now run on this account' : `Switch to ${account.label}: panes you open from now on run on it`}
            aria-label={active ? `${account.label}, active` : `Switch to ${account.label}`}
            onClick={() => !active && void store.getState().switchTo(account.id)}
          >
            <span className={cn('mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border', active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>
              {active && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-foreground">{account.label}</span>
                {plan && <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{plan}</span>}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{account.email ?? 'no email yet'}</span>
            </span>
          </button>
          <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={`Rename ${account.label}`} title="Rename" onClick={() => setEditing({ kind: 'rename', id: account.id })}>
            <Pencil />
          </Button>
          {!account.isDefault && (
            <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" aria-label={`Remove ${account.label}`} title="Remove" onClick={() => setEditing({ kind: 'remove', id: account.id })}>
              <Trash2 />
            </Button>
          )}
        </div>
      )}
      {removing && (
        <div role="alertdialog" aria-label={`Remove ${account.label}`} className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug">
          <span>
            Remove <b>{account.label}</b> from the app? Its folder <code className="break-all">{account.configDir}</code> stays on disk, login and all.
          </span>
          <span className="flex justify-end gap-1.5">
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={async () => {
                if (await store.getState().remove(account.id)) setEditing(null)
              }}
            >
              Remove
            </Button>
          </span>
        </div>
      )}
      {account.problem && (
        <p className="flex items-start gap-1 text-[11px] leading-snug text-status-warning" data-problem="">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{account.problem}</span>
        </p>
      )}
      <AccountUsage entry={entry} now={now} />
    </li>
  )
}

/** Every account with its plan usage; the active one is marked and picking another switches.
 *  Accounts are added (then logged in from a terminal), renamed and removed here. `onAdded`: a new
 *  account's login terminal opened. */
export function AccountsPanel({ onAdded, now = Date.now() }: { onAdded?(): void; now?: number }) {
  const store = useAccountsStore()
  const state = useAccounts((s) => s.state)
  const usage = useAccounts((s) => s.usage)
  const error = useAccounts((s) => s.error)
  const [editing, setEditing] = useState<Editing>(null)
  const [adding, setAdding] = useState<'no' | 'asking' | 'busy'>('no')
  if (!state) return null
  return (
    <div className="flex flex-col gap-2 p-2" data-accounts-panel="">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-xs font-semibold text-muted-foreground">Claude accounts</span>
        <span className="text-[10px] text-muted-foreground/70">new panes run on the marked one</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {state.accounts.map((a) => (
          <AccountCard key={a.id} account={a} active={a.id === state.active} entry={usage[a.id]} now={now} editing={editing} setEditing={setEditing} />
        ))}
      </ul>
      {error && (
        <div role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded-sm opacity-70 hover:opacity-100" onClick={() => store.getState().clearError()}>
            <X className="size-3" />
          </button>
        </div>
      )}
      {adding === 'no' ? (
        <Button type="button" size="xs" variant="ghost" className="justify-start text-muted-foreground" onClick={() => setAdding('asking')}>
          <Plus /> Add account
        </Button>
      ) : adding === 'busy' ? (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Adding…
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <LabelInput
            initial=""
            placeholder="New account's name"
            submit="Add"
            onCancel={() => setAdding('no')}
            onSave={async (label) => {
              setAdding('busy')
              const added = await store.getState().add(label)
              setAdding(added ? 'no' : 'asking')
              if (added) onAdded?.()
            }}
          />
          <span className="px-0.5 text-[10px] leading-snug text-muted-foreground">A terminal opens on it for you to log in. The account you are on stays active.</span>
        </div>
      )}
    </div>
  )
}

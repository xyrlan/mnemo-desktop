import { useEffect, useRef, useState, type JSX } from 'react'
import { AGENT_KINDS, KIND_LABEL, kindOf, type AgentKind } from '../../agent/kind'
import { age, limitName, percentNow, resetsWhen, tone } from '../../accounts/format'
import { useAccounts, useAccountsStore, type Usage } from '../../accounts/store'
import type { Account, PlanLimit } from '../../accounts/types'
import { pollWhileShown } from '../../shell/while-shown'
import { confirm } from '../ui/confirm'
import { inTerminal } from '../windows/setup/terminal'
import { envOfAccount } from '../../mission/account'
import { signInCommand } from './sign-in'
import './accounts.css'

/** The time, again every 30 s while the window shows: resets and ages read from it. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => pollWhileShown(() => setNow(Date.now()), 30_000, { wait: true }), [])
  return now
}

const say = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A name typed in place: Enter saves, Esc cancels the typing and nothing around it (it is caught
 *  on `window`, before a window's or a menu's own Esc on `document`). */
function NameInput({ initial, placeholder, submit, onSave, onCancel }: { initial: string; placeholder: string; submit: string; onSave(label: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  const label = value.trim()
  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== input.current) return
      e.preventDefault()
      e.stopPropagation()
      cancel.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <form
      className="nx-acct-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (label) onSave(label)
      }}
    >
      <input ref={input} className="nx-input" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="nx-btn" data-tone="go" disabled={!label}>
        {submit}
      </button>
      <button type="button" className="nx-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

/** A bar `percent` long, coloured by the limit's severity. */
export function Bar({ percent, severity, label }: { percent: number; severity: string; label: string }): JSX.Element {
  return (
    <span className="nx-acct-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label} data-tone={tone(severity)}>
      <span style={{ width: `${percent}%` }} />
    </span>
  )
}

function Limit({ limit, now }: { limit: PlanLimit; now: number }) {
  const name = limitName(limit)
  const percent = percentNow(limit, now)
  const resets = resetsWhen(limit.resetsAt, now)
  return (
    <li className="nx-acct-limit" data-limit={limit.kind}>
      <span className="nx-acct-limit-name" title={`${limit.kind} · ${limit.severity}`}>
        {name}
      </span>
      <span className="nx-acct-limit-pct">
        <b>{percent}%</b>
        {resets && <span className="nx-muted"> {resets === 'reset' ? 'reset' : `resets ${resets}`}</span>}
      </span>
      <Bar percent={percent} severity={limit.severity} label={`${name}: ${percent}%`} />
    </li>
  )
}

/** What an account's usage reads: every limit, or why there is none, and how old an old reading is.
 *  A Grok account's is its credit usage, and says so when it cannot be read. */
function AccountUsage({ entry, now, kind }: { entry: Usage | undefined; now: number; kind: AgentKind }) {
  const usage = entry?.usage
  if (!usage) {
    const grok = kind === 'grok'
    const said = entry?.error ? `${grok ? 'Credit usage unavailable' : 'No usage'}: ${entry.error}` : `Reading ${grok ? 'credit usage' : 'usage'}…`
    return <p className="nx-acct-line nx-muted">{said}</p>
  }
  return (
    <>
      {usage.limits.length ? (
        <ul className="nx-acct-limits">
          {usage.limits.map((l, i) => (
            <Limit key={`${l.kind}-${l.model ?? ''}-${i}`} limit={l} now={now} />
          ))}
        </ul>
      ) : (
        <p className="nx-acct-line nx-muted">No limits in this plan's reading.</p>
      )}
      {usage.stale && (
        <p className="nx-acct-line nx-muted" data-stale="">
          Read {age(usage.fetchedAt, now)}: {usage.stale}
        </p>
      )}
      {!usage.stale && entry?.error && (
        <p className="nx-acct-line nx-muted">
          Read {age(usage.fetchedAt, now)}; the last try failed: {entry.error}
        </p>
      )}
    </>
  )
}

type Props = {
  now: number
  /** A sign-in terminal opened: the drawer shows it, so what covers the ship gives way. */
  onTerminal(): void
}

function AccountCard({ account, active, entry, now, renaming, setRenaming, onTerminal, fail, mixed }: Props & {
  account: Account
  active: boolean
  /** The list holds more than one kind: each account says its own. */
  mixed: boolean
  entry: Usage | undefined
  renaming: boolean
  setRenaming(on: boolean): void
  fail(why: string): void
}) {
  const store = useAccountsStore()
  const [sharing, setSharing] = useState(false)
  const plan = entry?.usage?.plan
  const kind = kindOf(account.kind)
  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${account.label}?`,
      body: `It leaves the app. Its folder ${account.configDir} stays on disk, login and all.`,
      confirm: 'Remove',
      danger: true,
    })
    if (ok) await store.getState().remove(account.id)
  }
  const signIn = () =>
    inTerminal(signInCommand(account), `Sign in: ${account.label}`).then(onTerminal, (e: unknown) => fail(`Could not open a terminal to sign in to ${account.label}: ${say(e)}`))
  return (
    <li className="nx-acct" data-account={account.id} data-active={active ? '' : undefined} aria-current={active || undefined}>
      {renaming ? (
        <NameInput
          initial={account.label}
          placeholder="Account name"
          submit="Save"
          onCancel={() => setRenaming(false)}
          onSave={async (label) => {
            if (await store.getState().rename(account.id, label)) setRenaming(false)
          }}
        />
      ) : (
        <div className="nx-acct-head">
          <button
            type="button"
            className="nx-acct-pick"
            title={active ? 'Sessions you start now run on this account' : `Switch to ${account.label}: sessions you start from now on run on it`}
            aria-label={active ? `${account.label}, active` : `Switch to ${account.label}`}
            onClick={() => !active && void store.getState().switchTo(account.id)}
          >
            <span className="nx-acct-mark" aria-hidden>
              {active ? '◆' : '◇'}
            </span>
            <span className="nx-acct-who">
              <span className="nx-acct-name">
                {account.label}
                {mixed && (
                  <span className="nx-acct-plan" data-kind={kind}>
                    {KIND_LABEL[kind]}
                  </span>
                )}
                {plan && <span className="nx-acct-plan">{plan}</span>}
              </span>
              <span className="nx-acct-email nx-muted">{account.email ?? 'no email yet'}</span>
            </span>
          </button>
          <span className="nx-acct-actions">
            <button type="button" className="nx-btn" aria-label={`Rename ${account.label}`} onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button
              type="button"
              className="nx-btn"
              aria-label={`Sign in to ${account.label}`}
              title={
                kind === 'grok'
                  ? `Opens a terminal running grok login on ${account.label}`
                  : `Opens a terminal running claude on ${account.label}: it asks to log in, or type /login there`
              }
              onClick={() => void signIn()}
            >
              Sign in
            </button>
            {!account.isDefault && (
              <button type="button" className="nx-btn" data-tone="danger" aria-label={`Remove ${account.label}`} onClick={() => void remove()}>
                Remove
              </button>
            )}
          </span>
        </div>
      )}
      {account.problem && (
        <p className="nx-acct-line nx-acct-problem" data-problem="">
          ▲ {account.problem}
        </p>
      )}
      {account.unshared.length > 0 && (
        <button
          type="button"
          className="nx-btn nx-acct-share"
          disabled={sharing}
          title={`Moves this account's own ${account.unshared.join(', ')} into the default account's and links ${account.unshared.length === 1 ? 'it' : 'them'}. Nothing is written over: what differs from the default account's is kept in a folder beside it.`}
          onClick={async () => {
            setSharing(true)
            await store.getState().share(account.id)
            setSharing(false)
          }}
        >
          {sharing ? 'Sharing…' : 'Share with the default account'}
        </button>
      )}
      <AccountUsage entry={entry} now={now} kind={kind} />
    </li>
  )
}

/** The CLI a new account runs: Claude Code or Grok Build, chosen as it is added. */
function KindPicker({ kind, onPick }: { kind: AgentKind; onPick(kind: AgentKind): void }) {
  return (
    <div className="nx-acct-form" role="group" aria-label="New account's CLI">
      {AGENT_KINDS.map((k) => (
        <button key={k} type="button" className="nx-btn" aria-pressed={k === kind} data-tone={k === kind ? 'go' : undefined} onClick={() => onPick(k)}>
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  )
}

/** Every Claude Code and Grok Build account with its usage, in the ship's look: the active one is
 *  marked and a click on another switches; new sessions run on its CLI. Accounts are added (of the
 *  kind chosen; a terminal opens on the new one to log in), renamed, signed in to again and removed
 *  (after a confirmation) here. Draws nothing until the accounts are known. */
export function AccountsList({ now, onTerminal }: Props): JSX.Element | null {
  const store = useAccountsStore()
  const state = useAccounts((s) => s.state)
  const usage = useAccounts((s) => s.usage)
  const error = useAccounts((s) => s.error)
  const note = useAccounts((s) => s.note)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [adding, setAdding] = useState<'no' | 'asking' | 'busy'>('no')
  const [kind, setKind] = useState<AgentKind>('claude')
  const [failed, setFailed] = useState<string | null>(null)
  if (!state) return null
  const mixed = new Set(state.accounts.map((a) => kindOf(a.kind))).size > 1
  // Where a new Grok account goes (`Place::add`): `~/.grok` while no account is there.
  const grokHomeTaken = state.accounts.some((a) => envOfAccount(a).kind === 'grok' && envOfAccount(a).config_dir === null)
  return (
    <div className="nx-accts" data-accounts-panel="">
      <p className="nx-acct-line nx-muted">New sessions run on the marked account.</p>
      <ul className="nx-acct-list">
        {state.accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            active={a.id === state.active}
            entry={usage[a.id]}
            now={now}
            renaming={renaming === a.id}
            setRenaming={(on) => setRenaming(on ? a.id : null)}
            onTerminal={onTerminal}
            fail={setFailed}
            mixed={mixed}
          />
        ))}
      </ul>
      {[
        { text: error, role: 'alert', clear: () => store.getState().clearError() },
        { text: failed, role: 'alert', clear: () => setFailed(null) },
        { text: note, role: 'status', clear: () => store.getState().clearNote() },
      ].map(
        (m, i) =>
          m.text && (
            <div key={i} role={m.role} className="nx-acct-say" data-tone={m.role === 'alert' ? 'danger' : undefined}>
              <span>{m.text}</span>
              <button type="button" className="nx-acct-x" aria-label="Dismiss" onClick={m.clear}>
                ×
              </button>
            </div>
          ),
      )}
      {adding === 'no' ? (
        <button
          type="button"
          className="nx-btn nx-acct-add"
          onClick={() => {
            setKind('claude')
            setAdding('asking')
          }}
        >
          + Add account
        </button>
      ) : adding === 'busy' ? (
        <p className="nx-acct-line nx-muted">Adding…</p>
      ) : (
        <div className="nx-accts">
          <KindPicker kind={kind} onPick={setKind} />
          <NameInput
            initial=""
            placeholder="New account's name"
            submit="Add"
            onCancel={() => setAdding('no')}
            onSave={async (label) => {
              setAdding('busy')
              const account = await store.getState().add(label, kind)
              setAdding(account ? 'no' : 'asking')
              // Its login terminal opened in a drawer tab, as Sign in's does: the list gives way to it.
              if (account) onTerminal()
            }}
          />
          <p className="nx-acct-line nx-muted">
            {kind === 'grok'
              ? `A terminal opens on it running grok login. ${grokHomeTaken ? 'It gets a folder of its own, ~/.grok-<name>.' : 'It is ~/.grok, with the login grok has there already.'} The account you are on stays active.`
              : 'A terminal opens on it for you to log in. The account you are on stays active.'}
          </p>
        </div>
      )}
    </div>
  )
}

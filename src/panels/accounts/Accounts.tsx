// The Accounts panel: every Claude Code and Grok Build account with its plan windows and when
// each resets. One press switches; an account is added, renamed, signed in to again, shared
// with the default one and removed here. New sessions run on the marked account.

import { useEffect, useRef, useState } from 'react'
import { AGENT_KINDS, KIND_LABEL, kindOf, type AgentKind } from '../../agent/kind'
import { age, limitName, percentNow, resetsWhen, tone } from '../../accounts/format'
import { useAccounts, useAccountsStore, type Usage } from '../../accounts/store'
import type { Account, PlanLimit } from '../../accounts/types'
import { envOfAccount } from '../../mission/account'
import { signInCommand } from '../../nexus/accounts/sign-in'
import { pollWhileShown } from '../../shell/while-shown'
import { ArmBtn, Btn, closePanel, Field, Loading, Notice, Progress, say, Seg, short } from '../memory/kit'
import { inTerminal } from '../setup/terminal'
import './accounts.css'

/** The time, again every 30 s while the window shows: resets and ages read from it. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => pollWhileShown(() => setNow(Date.now()), 30_000, { wait: true }), [])
  return now
}

/** A name typed in place: Enter saves, Esc cancels the typing and nothing around it. */
function NameInput({ initial, placeholder, submit, onSave, onCancel }: { initial: string; placeholder: string; submit: string; onSave(label: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const label = value.trim()
  useEffect(() => input.current?.focus(), [])
  return (
    <form
      className="sp-row accounts-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (label) onSave(label)
      }}
      onKeyDown={(e) => {
        // Before the panel's own Esc, which would close the panel with the name half typed.
        if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onCancel())
      }}
    >
      <Field ref={input} className="sp-grow" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setValue(e.target.value)} />
      <Btn type="submit" tone="go" small disabled={!label}>
        {submit}
      </Btn>
      <Btn small onClick={onCancel}>
        Cancel
      </Btn>
    </form>
  )
}

function Limit({ limit, now }: { limit: PlanLimit; now: number }) {
  const name = limitName(limit)
  const percent = percentNow(limit, now)
  const resets = resetsWhen(limit.resetsAt, now)
  const t = tone(limit.severity)
  return (
    <li className="accounts-limit" data-limit={limit.kind} data-tone={t}>
      <span className="mn-label accounts-limit-name">{name}</span>
      <span className="accounts-limit-pct mn-num">
        {percent}
        <i>%</i>
      </span>
      <Progress value={percent / 100} label={`${name}: ${percent}%`} tone={t} />
      <span className="sp-dim accounts-limit-reset">
        {/* The endpoint's own word when it is not the ordinary one: a window near its end says so. */}
        {t !== 'ok' && t !== 'unknown' && <b className="accounts-severity">{limit.severity} · </b>}
        {resets ? (resets === 'reset' ? 'reset' : `resets ${resets}`) : 'no reset given'}
      </span>
    </li>
  )
}

/** What an account's usage reads: every limit, or why there is none, and how old an old reading
 *  is. A Grok account's is its credit usage, and says so when it cannot be read. */
function AccountUsage({ entry, now, kind }: { entry: Usage | undefined; now: number; kind: AgentKind }) {
  const usage = entry?.usage
  if (!usage) {
    const grok = kind === 'grok'
    return entry?.error ? <p className="accounts-line sp-dim">{`${grok ? 'Credit usage unavailable' : 'No usage'}: ${entry.error}`}</p> : <Loading>reading {grok ? 'credit usage' : 'usage'}…</Loading>
  }
  return (
    <>
      {usage.limits.length ? (
        <ul className="accounts-limits">
          {usage.limits.map((l, i) => (
            <Limit key={`${l.kind}-${l.model ?? ''}-${i}`} limit={l} now={now} />
          ))}
        </ul>
      ) : (
        <p className="accounts-line sp-dim">No limits in this plan's reading.</p>
      )}
      {usage.stale && (
        <p className="accounts-line sp-dim" data-stale="">
          Read {age(usage.fetchedAt, now)}: {usage.stale}
        </p>
      )}
      {!usage.stale && entry?.error && (
        <p className="accounts-line sp-dim">
          Read {age(usage.fetchedAt, now)}; the last try failed: {entry.error}
        </p>
      )}
    </>
  )
}

function AccountCard({ account, active, entry, now, renaming, setRenaming, fail, mixed }: {
  account: Account
  active: boolean
  entry: Usage | undefined
  now: number
  renaming: boolean
  setRenaming(on: boolean): void
  fail(why: string): void
  /** The list holds more than one kind: each account says its own. */
  mixed: boolean
}) {
  const store = useAccountsStore()
  const [sharing, setSharing] = useState(false)
  const plan = entry?.usage?.plan
  const kind = kindOf(account.kind)
  // The terminal takes the screen: the panel gives way to it.
  const signIn = () => inTerminal(signInCommand(account), `Sign in: ${account.label}`).then(closePanel, (e: unknown) => fail(`Could not open a terminal to sign in to ${account.label}: ${say(e)}`))
  return (
    <li className="accounts-card" data-account={account.id} data-active={active ? '' : undefined} aria-current={active || undefined}>
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
        <div className="accounts-head">
          <button type="button" className="accounts-pick" aria-label={active ? `${account.label}, active` : `Switch to ${account.label}`} disabled={active} onClick={() => void store.getState().switchTo(account.id)}>
            <span className="accounts-mark" aria-hidden="true">
              {active ? '◆' : '◇'}
            </span>
            <span className="sp-grow">
              <span className="accounts-name">
                {account.label}
                {plan && <span className="sp-tag">{plan}</span>}
                {mixed && (
                  <span className="sp-tag" data-kind={kind}>
                    {KIND_LABEL[kind]}
                  </span>
                )}
              </span>
              <span className="sp-dim accounts-sub">
                {account.email ?? 'no email yet'} · <span className="sp-mono">{short(account.configDir)}</span>
              </span>
            </span>
            <span className="accounts-state">{active ? 'new sessions run here' : 'switch'}</span>
          </button>
        </div>
      )}
      {account.problem && (
        <p className="accounts-line accounts-problem" data-problem="">
          ▲ {account.problem}
        </p>
      )}
      <AccountUsage entry={entry} now={now} kind={kind} />
      <div className="sp-wrap accounts-acts">
        <Btn small aria-label={`Rename ${account.label}`} onClick={() => setRenaming(true)}>
          Rename
        </Btn>
        <Btn small aria-label={`Sign in to ${account.label}`} onClick={() => void signIn()}>
          Sign in
        </Btn>
        {account.unshared.length > 0 && (
          <Btn
            small
            disabled={sharing}
            onClick={async () => {
              setSharing(true)
              await store.getState().share(account.id)
              setSharing(false)
            }}
          >
            {sharing ? 'Sharing…' : 'Share with the default account'}
          </Btn>
        )}
        {!account.isDefault && (
          <ArmBtn small className="sp-end" aria-label={`Remove ${account.label}`} sure="Remove it from the app? Press again" onConfirm={() => void store.getState().remove(account.id)}>
            Remove
          </ArmBtn>
        )}
      </div>
      {account.unshared.length > 0 && (
        <p className="accounts-line sp-dim">
          It holds its own {account.unshared.join(', ')}. Sharing moves {account.unshared.length === 1 ? 'it' : 'them'} into the default account's and links {account.unshared.length === 1 ? 'it' : 'them'}; what differs is kept in a folder beside it.
        </p>
      )}
    </li>
  )
}

/** Adds an account of the kind chosen; a terminal opens on the new one to log in. */
function AddAccount({ grokHomeTaken }: { grokHomeTaken: boolean }) {
  const store = useAccountsStore()
  const [adding, setAdding] = useState<'no' | 'asking' | 'busy'>('no')
  const [kind, setKind] = useState<AgentKind>('claude')
  if (adding === 'no') {
    return (
      <Btn
        className="accounts-add"
        onClick={() => {
          setKind('claude')
          setAdding('asking')
        }}
      >
        + Add account
      </Btn>
    )
  }
  if (adding === 'busy') return <Loading>adding…</Loading>
  return (
    <div className="accounts-adding">
      <Seg<AgentKind> label="New account's CLI" value={kind} options={AGENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onPick={setKind} />
      <NameInput
        initial=""
        placeholder="New account's name"
        submit="Add"
        onCancel={() => setAdding('no')}
        onSave={async (label) => {
          setAdding('busy')
          const account = await store.getState().add(label, kind)
          setAdding(account ? 'no' : 'asking')
          // Its login terminal opened: the panel gives way to it.
          if (account) closePanel()
        }}
      />
      <p className="accounts-line sp-dim">
        {kind === 'grok'
          ? `A terminal opens on it running grok login. ${grokHomeTaken ? 'It gets a folder of its own, ~/.grok-<name>.' : 'It is ~/.grok, with the login grok has there already.'} The account you are on stays active.`
          : 'A terminal opens on it for you to log in. The account you are on stays active.'}
      </p>
    </div>
  )
}

export function AccountsPanel() {
  const store = useAccountsStore()
  const state = useAccounts((s) => s.state)
  const listError = useAccounts((s) => s.listError)
  const usage = useAccounts((s) => s.usage)
  const error = useAccounts((s) => s.error)
  const note = useAccounts((s) => s.note)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [trying, setTrying] = useState(false)
  const now = useNow()
  const known = state !== null
  // Opened, every account's usage is read again.
  useEffect(() => void store.getState().readUsage(true), [store, known])
  if (!state) {
    return (
      <div className="accounts sp-root" tabIndex={-1} data-accounts-panel="">
        {listError ? (
          <Notice tone="bad" text={`The accounts list could not be read: ${listError}. Until it can, new sessions run on the default account.`}>
            <Btn
              small
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
            </Btn>
          </Notice>
        ) : (
          <Loading>reading the accounts…</Loading>
        )}
      </div>
    )
  }
  const mixed = new Set(state.accounts.map((a) => kindOf(a.kind))).size > 1
  // Where a new Grok account goes: `~/.grok` while no account is there.
  const grokHomeTaken = state.accounts.some((a) => envOfAccount(a).kind === 'grok' && envOfAccount(a).config_dir === null)
  return (
    <div className="accounts sp-root" tabIndex={-1} data-accounts-panel="">
      <ul className="accounts-list">
        {state.accounts.map((a) => (
          <AccountCard key={a.id} account={a} active={a.id === state.active} entry={usage[a.id]} now={now} renaming={renaming === a.id} setRenaming={(on) => setRenaming(on ? a.id : null)} fail={setFailed} mixed={mixed} />
        ))}
      </ul>
      {error && <Notice tone="bad" text={error} onDismiss={() => store.getState().clearError()} />}
      {failed && <Notice tone="bad" text={failed} onDismiss={() => setFailed(null)} />}
      {note && <Notice tone="info" text={note} onDismiss={() => store.getState().clearNote()} />}
      <AddAccount grokHomeTaken={grokHomeTaken} />
    </div>
  )
}

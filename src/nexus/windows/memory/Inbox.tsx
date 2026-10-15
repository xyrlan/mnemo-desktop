import { useEffect, type JSX } from 'react'
import { useVault, vault } from '../../../vault/app-store'
import { splitFrontmatter, type InboxRow } from '../../../vault/inbox'
import { confirm } from '../../ui/confirm'
import { ErrorText, Folded, Loading, Markdown, openExternal, Quiet } from './kit'

/** Drops a staged page once the person says so. `mnemo` archives it, so the notice offers Undo. */
export async function dropStaged(key: string, cwd: string): Promise<void> {
  const ok = await confirm({ title: `Drop ${key}?`, body: 'It leaves the inbox and is archived; Undo restores it.', confirm: 'Drop', danger: true })
  if (ok) await vault.getState().dropInbox(key, cwd)
}

function Stats({ cwd }: { cwd: string }) {
  const stats = useVault((s) => s.inboxStats)
  const loading = useVault((s) => s.inboxStatsLoading)
  useEffect(() => {
    void vault.getState().loadInboxStats(cwd)
  }, [cwd])
  if (!stats) return loading ? <Loading>reading mnemo inbox --stats…</Loading> : null
  return (
    <div className="nx-mem-stats nx-muted">
      <span>
        {stats.staged} staged, median {stats.medianAgeDays ?? '—'}d, oldest {stats.oldestAgeDays ?? '—'}d
      </span>
      <span>
        last {stats.windowDays}d: {stats.offered} offered, {stats.promoted} promoted, {stats.dropped} dropped
      </span>
      {stats.expired !== null && (
        <span>
          {stats.expired} expired unreviewed, {stats.restored} restored
        </span>
      )}
      <span>{stats.medianDecisionDays === null ? 'no page both offered and decided yet' : `median offer → decision ${stats.medianDecisionDays}d`}</span>
    </div>
  )
}

function Notice({ cwd }: { cwd: string }) {
  const notice = useVault((s) => s.inboxNotice)
  if (!notice) return null
  return (
    <div className="nx-mem-notice" data-ok={notice.ok || undefined} role="status">
      <pre>{notice.text || (notice.ok ? 'done' : 'failed')}</pre>
      {notice.canRestore && (
        <button type="button" className="nx-btn" title={`mnemo inbox --restore ${notice.key}`} onClick={() => void vault.getState().restoreInbox(notice.key, cwd)}>
          Undo
        </button>
      )}
      <button type="button" className="nx-mem-x" aria-label="Dismiss" onClick={() => vault.getState().dismissInboxNotice()}>
        ×
      </button>
    </div>
  )
}

function Row({ row, cwd, selected, busy }: { row: InboxRow; cwd: string; selected: boolean; busy: boolean }) {
  const show = () => void vault.getState().showInbox(row.key, cwd)
  return (
    <tr className="nx-mem-tr" data-staged={row.key} aria-selected={selected}>
      <td className="nx-mem-key" title={row.key} onClick={show}>
        {row.key}
      </td>
      <td className="nx-muted">{row.reason}</td>
      <td className="nx-muted">{row.ageDays}d</td>
      <td title={row.description}>
        <div className="nx-mem-sub">{row.description}</div>
      </td>
      <td className="nx-mem-row-btns">
        <button type="button" className="nx-btn" disabled={busy} title={`mnemo inbox --show ${row.key}`} onClick={show}>
          Show
        </button>
        <button type="button" className="nx-btn" data-tone="go" disabled={busy} title={`mnemo inbox --promote ${row.key}`} onClick={() => void vault.getState().promoteInbox(row.key, cwd)}>
          {busy ? '…' : 'Promote'}
        </button>
        <button type="button" className="nx-btn" data-tone="danger" disabled={busy} title={`mnemo inbox --drop ${row.key}`} onClick={() => void dropStaged(row.key, cwd)}>
          Drop
        </button>
      </td>
    </tr>
  )
}

function Shown({ cwd }: { cwd: string }) {
  const key = useVault((s) => s.inboxSelected)
  const showing = useVault((s) => s.inboxShowing)
  const shown = useVault((s) => s.inboxShown)
  const error = useVault((s) => s.inboxShownError)
  const busy = useVault((s) => s.inboxBusy)
  if (!key) return <Quiet>Select a staged page to read it.</Quiet>
  if (showing) return <Loading>reading…</Loading>
  const { frontmatter, body } = splitFrontmatter(shown ?? '')
  return (
    <article className="nx-mem-page" data-shown={key}>
      <header className="nx-mem-page-head">
        <div className="nx-mem-side-bar">
          <h3 className="nx-mem-page-title nx-mem-grow">{key}</h3>
          <button type="button" className="nx-mem-x" aria-label="Close the staged page" title="Close (Esc)" onClick={() => vault.getState().closeInboxShown()}>
            ×
          </button>
        </div>
        {!error && (
          <div className="nx-mem-actions">
            <button type="button" className="nx-btn" data-tone="go" disabled={busy === key} onClick={() => void vault.getState().promoteInbox(key, cwd)}>
              {busy === key ? 'Promote…' : 'Promote'}
            </button>
            <button type="button" className="nx-btn" data-tone="danger" disabled={busy === key} onClick={() => void dropStaged(key, cwd)}>
              Drop
            </button>
          </div>
        )}
      </header>
      {error ? (
        <ErrorText text={error} onDismiss={() => vault.getState().closeInboxShown()} />
      ) : (
        <div className="nx-mem-page-body">
          <Markdown text={body} onWiki={() => {}} onLink={openExternal} />
          {frontmatter && (
            <Folded label="frontmatter">
              <pre className="nx-mem-out">{frontmatter}</pre>
            </Folded>
          )}
        </div>
      )}
    </article>
  )
}

/** `_inbox` review: the staged pages, one read on click, promoted or dropped. */
export function Inbox({ cwd, onLearned }: { cwd: string; onLearned(): void }): JSX.Element {
  const all = useVault((s) => s.inboxAll)
  const listing = useVault((s) => s.inboxListing)
  const loading = useVault((s) => s.inboxLoading)
  const error = useVault((s) => s.inboxError)
  const selected = useVault((s) => s.inboxSelected)
  const busy = useVault((s) => s.inboxBusy)

  useEffect(() => {
    void vault.getState().loadInbox(cwd)
  }, [cwd])

  return (
    <div className="nx-mem-inbox">
      <div className="nx-mem-bar">
        <label className="nx-mem-check" title="mnemo inbox --all">
          <input type="checkbox" checked={all} onChange={(e) => void vault.getState().setInboxAll(e.target.checked, cwd)} />
          every project
        </label>
        {listing && (
          <span className="nx-muted nx-mem-grow nx-mem-sub" title={listing.summary}>
            {listing.summary}
          </span>
        )}
        <span className="nx-mem-end">
          <button type="button" className="nx-btn" title="Review, once, the pages mnemo recovered from this repo's Claude Code history" onClick={onLearned}>
            What mnemo learned
          </button>
          <button type="button" className="nx-btn" disabled={loading} title="Re-read mnemo inbox" onClick={() => void vault.getState().loadInbox(cwd)}>
            ↻
          </button>
        </span>
      </div>
      <Stats cwd={cwd} />
      <Notice cwd={cwd} />
      {error && <ErrorText text={error} />}
      <div className="nx-mem-split">
        <div className="nx-mem-list">
          {!listing && loading && <Loading>reading mnemo inbox…</Loading>}
          {listing && listing.rows.length === 0 && !error && <Quiet>{listing.summary || 'Nothing staged in shared/_inbox/.'}</Quiet>}
          {listing && listing.rows.length > 0 && (
            <table className="nx-mem-table">
              <thead>
                <tr>
                  <th className="nx-mem-w-key">key</th>
                  <th className="nx-mem-w-reason">reason</th>
                  <th className="nx-mem-w-age">age</th>
                  <th>description</th>
                  <th className="nx-mem-w-btns" />
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((r) => (
                  <Row key={r.key} row={r} cwd={cwd} selected={r.key === selected} busy={busy === r.key} />
                ))}
              </tbody>
            </table>
          )}
          {listing && listing.other > 0 && !all && (
            <Quiet>
              {listing.other} more staged for other projects.{' '}
              <button type="button" className="nx-btn" onClick={() => void vault.getState().setInboxAll(true, cwd)}>
                Show all
              </button>
            </Quiet>
          )}
        </div>
        <aside className="nx-mem-side" aria-label="Staged page">
          <div className="nx-mem-side-body">
            <Shown cwd={cwd} />
          </div>
        </aside>
      </div>
    </div>
  )
}

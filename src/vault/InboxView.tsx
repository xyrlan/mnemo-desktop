import { useEffect } from 'react'
import { store } from '../layout/app-store'
import { reviewWhatWasLearned } from '../learned/open'
import { useVault, vault } from './app-store'
import { ErrorLine } from './ErrorLine'
import { splitFrontmatter, type InboxRow } from './inbox'
import { Markdown } from './Markdown'
import { useArm } from './useArm'

function StatsLine({ cwd }: { cwd: string | undefined }) {
  const stats = useVault((s) => s.inboxStats)
  const loading = useVault((s) => s.inboxStatsLoading)

  useEffect(() => {
    if (!vault.getState().inboxStats) void vault.getState().loadInboxStats(cwd ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  if (!stats) return <div className="ib-stats vt-empty">{loading ? 'reading mnemo inbox --stats…' : ''}</div>
  return (
    <div className="ib-stats">
      <span>{stats.staged} staged, median {stats.medianAgeDays ?? '—'}d, oldest {stats.oldestAgeDays ?? '—'}d</span>
      <span>
        last {stats.windowDays}d: {stats.offered} offered, {stats.promoted} promoted, {stats.dropped} dropped
      </span>
      {stats.expired !== null && <span>{stats.expired} expired unreviewed, {stats.restored} restored</span>}
      <span>{stats.medianDecisionDays === null ? 'no page both offered and decided yet' : `median offer → decision ${stats.medianDecisionDays}d`}</span>
      <button title="Re-run mnemo inbox --stats" disabled={loading} onClick={() => void vault.getState().loadInboxStats(cwd ?? '')}>
        {loading ? '…' : '↻'}
      </button>
    </div>
  )
}

function Notice({ cwd }: { cwd: string | undefined }) {
  const notice = useVault((s) => s.inboxNotice)
  if (!notice) return null
  return (
    <div className={`vt-error-line ib-notice${notice.ok ? ' ib-notice-ok' : ''}`}>
      <pre className={notice.ok ? undefined : 'vt-error'}>{notice.text}</pre>
      {notice.canRestore && (
        <button title={`Undo: mnemo inbox --restore ${notice.key}`} onClick={() => void vault.getState().restoreInbox(notice.key, cwd ?? '')}>
          Undo
        </button>
      )}
      <button title="Dismiss" aria-label="Dismiss" onClick={() => vault.getState().dismissInboxNotice()}>
        ×
      </button>
    </div>
  )
}

function Row({ row, cwd, selected, busy, armed, onDrop }: { row: InboxRow; cwd: string | undefined; selected: boolean; busy: boolean; armed: boolean; onDrop(): void }) {
  return (
    <tr className={`ib-row${selected ? ' vr-selected' : ''}`}>
      <td className="ib-key" title={row.key} onClick={() => void vault.getState().showInbox(row.key, cwd ?? '')}>
        {row.key}
      </td>
      <td className="ib-reason">{row.reason}</td>
      <td className="ib-age">{row.ageDays}d</td>
      <td className="ib-desc" title={row.description}>
        {row.description}
      </td>
      <td className="ib-acts">
        <button disabled={busy} onClick={() => void vault.getState().showInbox(row.key, cwd ?? '')}>
          Show
        </button>
        <button disabled={busy} onClick={() => void vault.getState().promoteInbox(row.key, cwd ?? '')}>
          {busy ? '…' : 'Promote'}
        </button>
        <button className={`vt-destructive${armed ? ' vt-armed' : ''}`} disabled={busy} onClick={onDrop}>
          {armed ? 'really drop?' : 'Drop'}
        </button>
      </td>
    </tr>
  )
}

function ShownPage({ cwd }: { cwd: string | undefined }) {
  const key = useVault((s) => s.inboxSelected)
  const showing = useVault((s) => s.inboxShowing)
  const shown = useVault((s) => s.inboxShown)
  const error = useVault((s) => s.inboxShownError)
  const busy = useVault((s) => s.inboxBusy)
  const { armed, press } = useArm()

  if (!key) return <div className="vt-page vt-empty">Select a staged page to read it.</div>
  if (showing) return <div className="vt-page vt-empty">reading…</div>

  const drop = () => {
    if (press(key)) void vault.getState().dropInbox(key, cwd ?? '')
  }

  return (
    <div className="vt-page">
      <header className="vt-page-head">
        <div className="vt-title-row">
          <span className="vt-title">{key}</span>
          <button title="Close" aria-label="Close" onClick={() => vault.getState().closeInboxShown()}>
            ×
          </button>
        </div>
        {!error && (
          <div className="vt-actions">
            <button disabled={busy === key} onClick={() => void vault.getState().promoteInbox(key, cwd ?? '')}>
              {busy === key ? 'Promote…' : 'Promote'}
            </button>
            <button className={`vt-destructive${armed === key ? ' vt-armed' : ''}`} disabled={busy === key} onClick={drop}>
              {armed === key ? 'really drop?' : 'Drop'}
            </button>
          </div>
        )}
      </header>
      {error ? (
        <div className="vt-page-error">
          <ErrorLine text={error} onDismiss={() => vault.getState().closeInboxShown()} />
        </div>
      ) : (
        (() => {
          const { frontmatter, body } = splitFrontmatter(shown ?? '')
          return (
            <div className="vt-body">
              <Markdown
                text={body}
                onWiki={() => {}}
                onLink={(href) => {
                  if (/^https?:\/\//.test(href)) store.getState().openView('browser', { url: href }, 'auto')
                }}
              />
              {frontmatter && (
                <details className="vt-frontmatter">
                  <summary>frontmatter</summary>
                  <pre>{frontmatter}</pre>
                </details>
              )}
            </div>
          )
        })()
      )}
    </div>
  )
}

/** `_inbox` review: `mnemo inbox` has no `--json`, so this reads its plain listing, shows one
 *  staged page on click, and promotes or drops it — instead of only counting `_inbox` on the
 *  health strip (round18, inbox-review). */
export function InboxView({ cwd }: { cwd: string | undefined }) {
  const all = useVault((s) => s.inboxAll)
  const listing = useVault((s) => s.inboxListing)
  const loading = useVault((s) => s.inboxLoading)
  const error = useVault((s) => s.inboxError)
  const selected = useVault((s) => s.inboxSelected)
  const busy = useVault((s) => s.inboxBusy)
  const { armed, press } = useArm()

  useEffect(() => {
    void vault.getState().loadInbox(cwd ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  return (
    <div className="ib">
      <div className="ib-bar">
        <label className="vr-toggle" title="mnemo inbox --all">
          <input type="checkbox" checked={all} onChange={(e) => void vault.getState().setInboxAll(e.target.checked, cwd ?? '')} />
          every project
        </label>
        {listing && <span className="vt-count">{listing.summary}</span>}
        <button className="ib-bar-end" title="Review, once, the pages mnemo recovered from this repo's Claude Code history" onClick={() => reviewWhatWasLearned(cwd)}>
          Review what mnemo learned
        </button>
        <button title="Re-read mnemo inbox" disabled={loading} onClick={() => void vault.getState().loadInbox(cwd ?? '')}>
          {loading ? '…' : '↻'}
        </button>
      </div>
      <StatsLine cwd={cwd} />
      <Notice cwd={cwd} />
      {error && <ErrorLine text={error} />}
      <div className="vr-main">
        <div className="ib-table">
          {listing && listing.rows.length === 0 && !error && <div className="vt-empty">{listing.summary || 'Nothing staged in shared/_inbox/.'}</div>}
          {listing && listing.rows.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>key</th>
                  <th>reason</th>
                  <th>age</th>
                  <th>description</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((r) => (
                  <Row
                    key={r.key}
                    row={r}
                    cwd={cwd}
                    selected={r.key === selected}
                    busy={busy === r.key}
                    armed={armed === r.key}
                    onDrop={() => (press(r.key) ? void vault.getState().dropInbox(r.key, cwd ?? '') : undefined)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {listing && listing.other > 0 && !all && (
            <div className="vt-empty">
              {listing.other} more staged for other projects —{' '}
              <button onClick={() => void vault.getState().setInboxAll(true, cwd ?? '')}>show all</button>
            </div>
          )}
        </div>
        <aside className="vr-side" aria-label="Staged page">
          <ShownPage cwd={cwd} />
        </aside>
      </div>
    </div>
  )
}

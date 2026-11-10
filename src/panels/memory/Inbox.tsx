// The inbox: the pages mnemo staged and has not been told to keep. Each is read in one press,
// kept in one, dropped in two; a drop can be taken back.

import { useEffect } from 'react'
import { useVault, vault } from '../../vault/app-store'
import { splitFrontmatter, type InboxRow } from '../../vault/inbox'
import { actions } from '../../world/actions'
import { ArmBtn, Btn, Loading, Markdown, Notice, openPanel, Out, Quiet } from './kit'

function Stats({ cwd }: { cwd: string }) {
  const stats = useVault((s) => s.inboxStats)
  const loading = useVault((s) => s.inboxStatsLoading)
  useEffect(() => {
    void vault.getState().loadInboxStats(cwd)
  }, [cwd])
  if (!stats) return loading ? <Loading>reading mnemo inbox --stats…</Loading> : null
  const days = (n: number | null) => (n === null ? '—' : `${n}d`)
  return (
    <div className="memory-stats" data-stats="">
      <span>
        <b className="mn-num">{stats.staged}</b> staged · median {days(stats.medianAgeDays)} · oldest {days(stats.oldestAgeDays)}
      </span>
      <span>
        last {stats.windowDays}d: <b className="mn-num">{stats.offered}</b> offered · <b className="mn-num">{stats.promoted}</b> kept · <b className="mn-num">{stats.dropped}</b> dropped
      </span>
      {stats.expired !== null && (
        <span>
          <b className="mn-num">{stats.expired}</b> expired unread · {stats.restored} restored
        </span>
      )}
      <span>{stats.medianDecisionDays === null ? 'no page both offered and decided yet' : `median offer to decision ${stats.medianDecisionDays}d`}</span>
    </div>
  )
}

/** What the last keep, drop or restore said; a drop offers to take it back. */
function Last({ cwd }: { cwd: string }) {
  const notice = useVault((s) => s.inboxNotice)
  if (!notice) return null
  return (
    <Notice tone={notice.ok ? 'ok' : 'bad'} text={notice.text || (notice.ok ? 'done' : 'failed')} onDismiss={() => vault.getState().dismissInboxNotice()}>
      {notice.canRestore && (
        <Btn small onClick={() => void vault.getState().restoreInbox(notice.key, cwd)}>
          Undo
        </Btn>
      )}
    </Notice>
  )
}

function Decide({ id, cwd, busy }: { id: string; cwd: string; busy: boolean }) {
  return (
    <>
      <Btn small tone="go" disabled={busy} onClick={() => void vault.getState().promoteInbox(id, cwd)}>
        {busy ? 'Working…' : 'Keep'}
      </Btn>
      <ArmBtn small disabled={busy} sure="Drop it? Press again" onConfirm={() => void vault.getState().dropInbox(id, cwd)}>
        Drop
      </ArmBtn>
    </>
  )
}

function Row({ row, cwd, selected, busy }: { row: InboxRow; cwd: string; selected: boolean; busy: boolean }) {
  return (
    <div className="memory-staged" data-staged={row.key} data-selected={selected || undefined}>
      <button type="button" className="memory-staged-open" onClick={() => void vault.getState().showInbox(row.key, cwd)}>
        <span className="sp-mono sp-clip memory-staged-key">{row.key}</span>
        <span className="sp-dim memory-sub">{row.description}</span>
      </button>
      <span className="sp-tag">{row.reason}</span>
      <span className="sp-dim mn-num memory-staged-age">{row.ageDays}d</span>
      <Decide id={row.key} cwd={cwd} busy={busy} />
    </div>
  )
}

function Shown({ cwd }: { cwd: string }) {
  const key = useVault((s) => s.inboxSelected)
  const showing = useVault((s) => s.inboxShowing)
  const shown = useVault((s) => s.inboxShown)
  const error = useVault((s) => s.inboxShownError)
  const busy = useVault((s) => s.inboxBusy)
  if (!key) return <Quiet>Pick a staged page to read it before you decide.</Quiet>
  if (showing) return <Loading>reading the staged page…</Loading>
  const { frontmatter, body } = splitFrontmatter(shown ?? '')
  return (
    <article className="memory-page" data-shown={key}>
      <header className="memory-page-head">
        <div className="sp-row">
          <h3 className="memory-page-title sp-grow">{key}</h3>
          <button type="button" className="sp-x" aria-label="Close the staged page" onClick={() => vault.getState().closeInboxShown()}>
            ×
          </button>
        </div>
        {!error && (
          <div className="sp-wrap memory-page-acts">
            <Decide id={key} cwd={cwd} busy={busy === key} />
          </div>
        )}
      </header>
      {error ? (
        <Notice tone="bad" text={error} onDismiss={() => vault.getState().closeInboxShown()} />
      ) : (
        <div className="memory-page-body">
          <Markdown text={body} onWiki={() => {}} onLink={(href) => void actions().external(href)} />
          {frontmatter && (
            <details className="sp-fold">
              <summary>frontmatter</summary>
              <Out>{frontmatter}</Out>
            </details>
          )}
        </div>
      )}
    </article>
  )
}

/** `mnemo inbox` runs in `cwd`, for its project unless every project is asked for. */
export function Inbox({ cwd }: { cwd: string }) {
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
    <div className="memory-inbox">
      <div className="sp-row memory-bar">
        <label className="sp-check">
          <input type="checkbox" checked={all} onChange={(e) => void vault.getState().setInboxAll(e.target.checked, cwd)} />
          every project
        </label>
        {listing && <span className="sp-dim sp-grow sp-clip">{listing.summary}</span>}
        <span className="sp-end">
          <Btn small tone="memory" onClick={() => openPanel('learned')}>
            What mnemo learned
          </Btn>
          <Btn small disabled={loading} onClick={() => void vault.getState().loadInbox(cwd)}>
            {loading ? 'Reading…' : 'Read again'}
          </Btn>
        </span>
      </div>
      <Stats cwd={cwd} />
      <Last cwd={cwd} />
      {error && <Notice tone="bad" text={error} />}
      <div className="memory-split memory-inbox-split">
        <div className="memory-list" role="group" aria-label="Staged pages">
          {!listing && loading && <Loading>reading mnemo inbox…</Loading>}
          {listing && listing.rows.length === 0 && !error && <Quiet>{listing.summary || 'Nothing staged in shared/_inbox/.'}</Quiet>}
          {listing?.rows.map((r) => (
            <Row key={r.key} row={r} cwd={cwd} selected={r.key === selected} busy={busy === r.key} />
          ))}
          {listing && listing.other > 0 && !all && (
            <div className="sp-row memory-other-staged">
              <Quiet>{listing.other} more staged for other projects.</Quiet>
              <Btn small onClick={() => void vault.getState().setInboxAll(true, cwd)}>
                Show all
              </Btn>
            </div>
          )}
        </div>
        <aside className="memory-side" aria-label="Staged page">
          <div className="memory-side-body">
            <Shown cwd={cwd} />
          </div>
        </aside>
      </div>
    </div>
  )
}

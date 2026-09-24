import { useEffect, type ReactNode } from 'react'
import { Archive, ArrowUpFromLine, CircleCheck, Eye, LoaderCircle, Sparkles } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { store } from '../layout/app-store'
import { reviewWhatWasLearned } from '../learned/open'
import { useVault, vault } from './app-store'
import { ERROR_TEXT, ErrorLine, MONO_TEXT } from './ErrorLine'
import { splitFrontmatter, type InboxRow } from './inbox'
import { Markdown } from './Markdown'
import { Frontmatter } from './PageView'
import { useArm } from './useArm'
import { Dismiss, EMPTY, Loading, Refresh, ROW_ACTIONS, ROW_TOOLBAR, RowAction, TH, Toggle, TR, TR_SELECTED } from './ui'

/** A destructive button's look while armed. */
const ARMED = 'bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive'

function Stat({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>
}

function StatsLine({ cwd }: { cwd: string | undefined }) {
  const stats = useVault((s) => s.inboxStats)
  const loading = useVault((s) => s.inboxStatsLoading)

  useEffect(() => {
    if (!vault.getState().inboxStats) void vault.getState().loadInboxStats(cwd ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  if (!stats) return loading ? <Loading className="ib-stats py-1.5">reading mnemo inbox --stats…</Loading> : <div className="ib-stats vt-empty" />
  return (
    <div className="ib-stats flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground tabular-nums">
      <Stat>{stats.staged} staged, median {stats.medianAgeDays ?? '—'}d, oldest {stats.oldestAgeDays ?? '—'}d</Stat>
      <Stat>
        last {stats.windowDays}d: {stats.offered} offered, {stats.promoted} promoted, {stats.dropped} dropped
      </Stat>
      {stats.expired !== null && <Stat>{stats.expired} expired unreviewed, {stats.restored} restored</Stat>}
      <Stat>{stats.medianDecisionDays === null ? 'no page both offered and decided yet' : `median offer → decision ${stats.medianDecisionDays}d`}</Stat>
      <Refresh className="ml-auto size-5" title="Re-run mnemo inbox --stats" busy={loading} onClick={() => void vault.getState().loadInboxStats(cwd ?? '')} />
    </div>
  )
}

function Notice({ cwd }: { cwd: string | undefined }) {
  const notice = useVault((s) => s.inboxNotice)
  if (!notice) return null
  return (
    <div
      className={cn(
        'vt-error-line ib-notice mx-3 mt-2 flex items-start gap-2 rounded-md border px-2 py-1.5',
        notice.ok ? 'ib-notice-ok border-status-success-border bg-status-success-background' : 'border-destructive/30 bg-destructive/10',
      )}
    >
      {notice.ok && <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-success" />}
      <pre className={notice.ok ? cn(MONO_TEXT, 'text-status-success') : ERROR_TEXT}>{notice.text}</pre>
      {notice.canRestore && (
        <Button type="button" variant="outline" size="xs" className="-my-0.5 h-5 text-[11px]" title={`Undo: mnemo inbox --restore ${notice.key}`} onClick={() => void vault.getState().restoreInbox(notice.key, cwd ?? '')}>
          Undo
        </Button>
      )}
      <Dismiss onClick={() => vault.getState().dismissInboxNotice()} className="-my-1 size-5" />
    </div>
  )
}

function Row({ row, cwd, selected, busy, armed, onDrop }: { row: InboxRow; cwd: string | undefined; selected: boolean; busy: boolean; armed: boolean; onDrop(): void }) {
  const show = () => void vault.getState().showInbox(row.key, cwd ?? '')
  return (
    <tr className={cn('ib-row group', TR, selected && cn('vr-selected', TR_SELECTED))}>
      <td className="ib-key cursor-pointer truncate px-2 py-1.5 font-mono text-[11px] text-foreground hover:text-brand" title={row.key} onClick={show}>
        {row.key}
      </td>
      <td className="ib-reason px-2 py-1.5 text-[11px] whitespace-nowrap text-muted-foreground">{row.reason}</td>
      <td className="ib-age px-2 py-1.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{row.ageDays}d</td>
      <td className="ib-desc truncate px-2 py-1.5 text-[12px] text-foreground" title={row.description}>
        {row.description}
      </td>
      {/* No width of its own: the toolbar floats back over the description's end. */}
      <td className="ib-acts relative w-0 p-0">
        <span className={cn(ROW_TOOLBAR, 'right-1', !selected && !armed && !busy && ROW_ACTIONS)}>
          <RowAction icon={<Eye />} label="Show" title={`mnemo inbox --show ${row.key}`} disabled={busy} onClick={show} />
          <RowAction icon={busy ? <LoaderCircle className="animate-spin" /> : <ArrowUpFromLine />} label={busy ? '…' : 'Promote'} title={`mnemo inbox --promote ${row.key}`} disabled={busy} onClick={() => void vault.getState().promoteInbox(row.key, cwd ?? '')} />
          <RowAction icon={<Archive />} label={armed ? 'really drop?' : 'Drop'} title={`mnemo inbox --drop ${row.key}`} armed={armed} destructive disabled={busy} onClick={onDrop} />
        </span>
      </td>
    </tr>
  )
}

const PAGE = 'vt-page flex min-h-0 min-w-0 flex-1 flex-col'

function ShownPage({ cwd }: { cwd: string | undefined }) {
  const key = useVault((s) => s.inboxSelected)
  const showing = useVault((s) => s.inboxShowing)
  const shown = useVault((s) => s.inboxShown)
  const error = useVault((s) => s.inboxShownError)
  const busy = useVault((s) => s.inboxBusy)
  const { armed, press } = useArm()

  if (!key) return <div className={cn(PAGE, EMPTY, 'vt-empty')}>Select a staged page to read it.</div>
  if (showing) return <Loading className={PAGE}>reading…</Loading>

  const drop = () => {
    if (press(key)) void vault.getState().dropInbox(key, cwd ?? '')
  }

  return (
    <div className={PAGE}>
      <header className="vt-page-head flex flex-col gap-1.5 border-b border-border px-3 pt-2.5 pb-2">
        <div className="vt-title-row flex items-center gap-1">
          <span className="vt-title min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-foreground">{key}</span>
          <Dismiss title="Close" onClick={() => vault.getState().closeInboxShown()} />
        </div>
        {!error && (
          <div className="vt-actions flex flex-wrap items-center gap-1">
            <Button type="button" variant="outline" size="xs" className="text-[11px]" disabled={busy === key} onClick={() => void vault.getState().promoteInbox(key, cwd ?? '')}>
              {busy === key ? 'Promote…' : 'Promote'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className={cn('vt-destructive text-[11px] text-destructive/90 hover:text-destructive', armed === key && cn('vt-armed border-destructive/60 dark:border-destructive/60', ARMED))}
              disabled={busy === key}
              onClick={drop}
            >
              {armed === key ? 'really drop?' : 'Drop'}
            </Button>
          </div>
        )}
      </header>
      {error ? (
        <div className="vt-page-error p-3">
          <ErrorLine text={error} onDismiss={() => vault.getState().closeInboxShown()} />
        </div>
      ) : (
        (() => {
          const { frontmatter, body } = splitFrontmatter(shown ?? '')
          return (
            <div className="vt-body min-h-0 flex-1 overflow-auto px-3 pt-1 pb-4">
              <Markdown
                text={body}
                onWiki={() => {}}
                onLink={(href) => {
                  if (/^https?:\/\//.test(href)) store.getState().openView('browser', { url: href }, 'auto')
                }}
              />
              {frontmatter && (
                <Frontmatter>
                  <pre className="m-0 mt-1 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground">{frontmatter}</pre>
                </Frontmatter>
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
    <div className="ib flex min-h-0 flex-1 flex-col">
      <div className="ib-bar flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <Toggle className="vr-toggle" title="mnemo inbox --all" checked={all} onChange={(on) => void vault.getState().setInboxAll(on, cwd ?? '')}>
          every project
        </Toggle>
        {listing && <span className="vt-count min-w-0 truncate text-[11px] text-muted-foreground" title={listing.summary}>{listing.summary}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button type="button" variant="outline" size="xs" className="ib-bar-end text-[11px]" title="Review, once, the pages mnemo recovered from this repo's Claude Code history" onClick={() => reviewWhatWasLearned(cwd)}>
            <Sparkles />
            Review what mnemo learned
          </Button>
          <Refresh title="Re-read mnemo inbox" busy={loading} onClick={() => void vault.getState().loadInbox(cwd ?? '')} />
        </div>
      </div>
      <StatsLine cwd={cwd} />
      <Notice cwd={cwd} />
      {error && <ErrorLine text={error} className="mx-3 mt-2" />}
      <div className="vr-main flex min-h-0 flex-1">
        <div className="ib-table min-w-0 flex-1 overflow-auto">
          {listing && listing.rows.length === 0 && !error && <div className={cn('vt-empty', EMPTY, 'px-3')}>{listing.summary || 'Nothing staged in shared/_inbox/.'}</div>}
          {listing && listing.rows.length > 0 && (
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  <th className={cn(TH, 'w-[32%] pl-3')}>key</th>
                  <th className={cn(TH, 'w-[88px]')}>reason</th>
                  <th className={cn(TH, 'w-[48px]')}>age</th>
                  <th className={TH}>description</th>
                  <th className={cn(TH, 'w-0 p-0')} />
                                  </tr>
              </thead>
              <tbody className="[&_td:first-child]:pl-3">
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
            <div className={cn('vt-empty flex items-center gap-1', EMPTY, 'px-3')}>
              {listing.other} more staged for other projects —
              <Button type="button" variant="link" size="xs" className="h-auto px-0 text-[12px] text-brand" onClick={() => void vault.getState().setInboxAll(true, cwd ?? '')}>
                show all
              </Button>
            </div>
          )}
        </div>
        <aside className="vr-side flex max-w-[560px] min-w-[300px] basis-[36%] flex-col border-l border-border" aria-label="Staged page">
          <ShownPage cwd={cwd} />
        </aside>
      </div>
    </div>
  )
}

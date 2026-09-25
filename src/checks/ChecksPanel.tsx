// adapted from stablyai/orca components/right-sidebar/ChecksPanel.tsx,
// checks-panel/active-content.tsx, checks-panel/empty-content.tsx, checks-panel/triage-strip.tsx,
// checks-panel/checks-list.tsx, checks-panel/check-run-details.tsx,
// checks-panel/check-presentation.tsx, check-job-log-tail.tsx, checks-panel/comment-row.tsx and
// pull-request-page/actions/panel.tsx
import React, { useEffect, useRef, useState } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  AlertTriangle,
  Check as CheckIcon,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Copy,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { Sent, Destination } from './agent'
import type { Check, CheckDetails, ChecksPr, ChecksView, Comment, MergeMethod, Thread } from './client'
import { commentPrompt, countChecks, detailsKey, isFailure, mergeBlock, METHOD_LABEL, plural, relativeTime, statusLabel, threadPrompt } from './model'
import { message, type Busy, type ChecksState, type DetailState } from './store'

export type Notify = { ok(text: string): void; fail(text: string): void }

export type ChecksPanelProps = {
  /** The worktree on screen; null before one is chosen. */
  worktree: string | null
  store: StoreApi<ChecksState>
  /** Where a send to the agent would go now. */
  destination: Destination
  /** Sends a prompt to the worktree's agent, starting one when there is none. */
  onSend(worktree: string, text: string): Promise<Sent>
  onOpenUrl(url: string, title: string): void
  /** Opens the commit composer, which pushes and opens a pull request. */
  onCreatePr(worktree: string): void
  notify: Notify
  /** For tests: the clock relative times are read against. */
  now?: number
}

const CHECK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CircleCheck,
  failure: CircleX,
  pending: LoaderCircle,
  cancelled: CircleX,
  skipped: CircleMinus,
  neutral: CircleDashed,
  timed_out: CircleX,
  startup_failure: CircleX,
  action_required: AlertTriangle,
  stale: CircleDashed,
}

const CHECK_COLOR: Record<string, string> = {
  success: 'text-emerald-500',
  failure: 'text-rose-500',
  pending: 'text-amber-500',
  cancelled: 'text-muted-foreground/60',
  skipped: 'text-muted-foreground/60',
  neutral: 'text-muted-foreground',
  timed_out: 'text-rose-500',
  startup_failure: 'text-rose-500',
  action_required: 'text-amber-500',
  stale: 'text-muted-foreground',
}

function prStateColor(state: ChecksPr['state']): string {
  switch (state) {
    case 'merged':
      return 'bg-purple-500/15 text-purple-500 border-purple-500/20'
    case 'closed':
      return 'bg-destructive/10 text-destructive border-destructive/20'
    case 'draft':
      return 'bg-muted text-muted-foreground/70 border-border'
    case 'open':
      return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20'
  }
}

const REVIEW: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: 'Approved', tone: 'text-emerald-500' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'text-rose-500' },
  REVIEW_REQUIRED: { label: 'Review required', tone: 'text-muted-foreground' },
  COMMENTED: { label: 'Reviewed', tone: 'text-muted-foreground' },
}

/** A check's link is whatever the CI app that reported it wrote: only a web page is opened. */
const web = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url)

/** What a send button says about where its prompt goes. */
function sendTitle(d: Destination, what: string): string {
  if (d.kind === 'agent') return `Send ${what} to ${d.target.title}`
  if (d.kind === 'start') return `Start an agent in this workspace and send it ${what}`
  return d.reason
}

function EmptyState({ title, detail, children }: { title: string; detail?: React.ReactNode; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-4 py-6" data-checks-empty>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {detail && <div className="mt-1 text-xs break-words text-muted-foreground">{detail}</div>}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh(): void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
      title="Refresh"
      aria-label="Refresh"
      onClick={onRefresh}
      disabled={loading}
    >
      <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
    </button>
  )
}

function CopyButton({ text, title }: { text: string; title: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <CheckIcon className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

const ERROR_LINE = /(?:##\[error\]|::error::|::error\b|\berror:|FAILED|exit code|ENOENT|EACCES|panic:|panicked|AssertionError)/i

/** Orca's log excerpt: scrolled to its last error line, else to its end. */
export function LogTail({ text }: { text: string }): React.JSX.Element {
  const pre = useRef<HTMLPreElement | null>(null)
  useEffect(() => {
    const el = pre.current
    if (!el) return
    const lines = text.split(/\r?\n/)
    let at = lines.length - 1
    lines.forEach((l, i) => {
      if (ERROR_LINE.test(l)) at = i
    })
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight)
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = at < lines.length - 1 ? Math.min(max, Math.max(0, at * (Number.isFinite(lh) ? lh : 16) - el.clientHeight / 3)) : max
  }, [text])
  return (
    <div className="mt-2 min-w-0" data-log-tail>
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Log excerpt</div>
        <CopyButton text={text} title="Copy log excerpt" />
      </div>
      <pre ref={pre} className="scrollbar-sleek max-h-72 overflow-auto rounded bg-muted/40 p-2.5 font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </div>
  )
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CheckRunDetails({ check, state, onRetry, onOpenUrl }: { check: Check; state: DetailState | undefined; onRetry(): void; onOpenUrl(url: string, title: string): void }): React.JSX.Element {
  const details: CheckDetails | null = state?.details ?? null
  const shown = details ?? check
  const started = formatTime(details?.startedAt ?? check.startedAt)
  const completed = formatTime(details?.completedAt ?? check.completedAt)
  const failedSteps = details?.steps.filter((s) => isFailure(s.conclusion)) ?? []
  const annotations = details?.annotations ?? []
  return (
    <div className="mr-3 mb-1 ml-[26px] min-w-0 border-l border-border pl-3" data-check-details={check.name}>
      {state?.loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-1.5 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading check details…
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2.5 py-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Status: {statusLabel(shown)}</span>
            {started && <span>Started {started}</span>}
            {completed && <span>Completed {completed}</span>}
            {check.workflow && <span>{check.workflow}</span>}
            {check.jobId && <span className="font-mono">job #{check.jobId}</span>}
          </div>
          {check.description && <div className="text-[12px] break-words text-foreground">{check.description}</div>}
          {state?.error && (
            <div role="alert" className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-[12px] break-words text-destructive">{state.error}</span>
              <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={onRetry}>
                <RefreshCw className="size-3" />
                Retry
              </Button>
            </div>
          )}
          {failedSteps.length > 0 && (
            <div className="min-w-0 border-t border-border/60 pt-2">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Failed steps</div>
              <div className="grid gap-0.5">
                {failedSteps.map((s) => (
                  <div key={s.number} className="flex min-w-0 items-center gap-2 text-[12px]">
                    <CircleX className="size-3 shrink-0 text-rose-500" />
                    <span className="min-w-0 flex-1 truncate text-foreground" title={s.name}>
                      {s.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel(s)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {annotations.length > 0 && (
            <div className="min-w-0 border-t border-border/60 pt-2">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Annotations</div>
              <div className="flex flex-col gap-2">
                {annotations.map((a, i) => (
                  <div key={`${a.path}-${i}`} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                        {a.path || 'Annotation'}
                        {a.line ? `:${a.line}` : ''}
                      </span>
                      <span className={cn('shrink-0 text-[11px]', a.level === 'failure' ? 'text-rose-500' : a.level === 'warning' ? 'text-amber-500' : 'text-muted-foreground')}>{a.level}</span>
                    </div>
                    {a.title && <div className="mt-0.5 text-[12px] font-medium text-foreground">{a.title}</div>}
                    <div className="mt-0.5 text-[12px] break-words text-foreground">{a.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {details?.logTail && <LogTail text={details.logTail} />}
          {details?.logError && <div className="text-[12px] break-words text-muted-foreground">Its log could not be read: {details.logError}</div>}
          {!check.jobId && (
            <div className="text-[12px] text-muted-foreground">
              {check.conclusion === 'action_required'
                ? 'Needs a manual action on GitHub (e.g. approving the run) to unblock merging.'
                : 'This check did not run on GitHub Actions: its details are on the page it links to.'}
              {web(check.url) && (
                <button type="button" className="ml-1 text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={() => onOpenUrl(check.url!, check.name)}>
                  Open it
                </button>
              )}
            </div>
          )}
          {details && !failedSteps.length && !annotations.length && !details.logTail && !details.logError && (
            <div className="text-[12px] text-muted-foreground">No inline details are available for this check.</div>
          )}
        </div>
      )}
    </div>
  )
}

function ChecksList({
  worktree,
  checks,
  store,
  onOpenUrl,
}: {
  worktree: string
  checks: Check[]
  store: StoreApi<ChecksState>
  onOpenUrl(url: string, title: string): void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const details = useStore(store, (s) => s.details)
  const counts = countChecks(checks)
  const idOf = (c: Check) => c.url ?? c.name
  // An open check whose state changed (it finished, it ran again) is read again.
  const wanted = checks.filter((c) => c.jobId && expanded.has(idOf(c))).map(detailsKey).join('|')
  useEffect(() => {
    for (const c of checks) if (c.jobId && expanded.has(idOf(c))) void store.getState().loadDetails(worktree, c)
  }, [wanted, worktree, store])

  const toggle = (c: Check) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(idOf(c))) next.delete(idOf(c))
      else next.add(idOf(c))
      return next
    })

  if (!checks.length) return <div className="border-b border-border px-4 py-6 text-[11px] text-muted-foreground">No checks configured</div>
  return (
    <div data-checks-list>
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')} />
        {counts.passing > 0 && (
          <span className="flex items-center gap-1">
            <CircleCheck className="size-3 text-emerald-500" />
            {counts.passing} passing
          </span>
        )}
        {counts.failing > 0 && (
          <span className="flex items-center gap-1">
            <CircleX className="size-3 text-rose-500" />
            {counts.failing} failing
          </span>
        )}
        {counts.pending > 0 && (
          <span className="flex items-center gap-1">
            <LoaderCircle className="size-3 text-amber-500" />
            {counts.pending} pending
          </span>
        )}
      </button>
      {open && (
        <div className="border-b border-border py-1">
          {checks.map((c) => {
            const id = idOf(c)
            const conclusion = c.conclusion ?? 'pending'
            const Icon = CHECK_ICON[conclusion] ?? CircleDashed
            const isOpen = expanded.has(id)
            return (
              <div key={id} className="min-w-0" data-check={c.name} data-verdict={c.verdict}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className={cn('group/check-row flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/40', isOpen && 'bg-accent/25')}
                  onClick={() => toggle(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggle(c)
                    }
                  }}
                >
                  <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <Icon className={cn('size-3.5 shrink-0', CHECK_COLOR[conclusion] ?? 'text-muted-foreground', conclusion === 'pending' && 'animate-spin')} />
                  <span className="flex-1 truncate text-[12px] text-foreground" title={c.workflow ? `${c.workflow} / ${c.name}` : c.name}>
                    {c.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">{statusLabel(c)}</span>
                    {web(c.url) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 text-muted-foreground hover:text-foreground"
                        aria-label="Open check details"
                        title="Open check details"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenUrl(c.url!, c.name)
                        }}
                      >
                        <ExternalLink className="size-3" />
                      </Button>
                    )}
                  </span>
                </div>
                {isOpen && (
                  <CheckRunDetails check={c} state={c.jobId ? details[detailsKey(c)] : undefined} onRetry={() => void store.getState().loadDetails(worktree, c)} onOpenUrl={onOpenUrl} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TriageStrip({ pr, checks, busy, destination, onFix }: { pr: ChecksPr; checks: Check[]; busy: Busy; destination: Destination; onFix(): void }): React.JSX.Element | null {
  const counts = countChecks(checks)
  const row = (icon: React.ReactNode, title: string, hint: string, action?: React.ReactNode) => (
    <div className="border-b border-border px-3 py-2" data-triage>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-foreground">{title}</div>
          <div className="truncate text-[10px] text-muted-foreground" title={hint}>
            {hint}
          </div>
        </div>
        {action}
      </div>
    </div>
  )
  if (pr.mergeable === 'CONFLICTING')
    return row(<AlertTriangle className="size-3.5 shrink-0 text-amber-500" />, 'Conflicts block this PR', `Resolve them with ${pr.base} before checks and merge can complete.`)
  if (counts.failing > 0) {
    const fixing = busy?.kind === 'send' && busy.id === 'fix'
    return row(
      <CircleX className="size-3.5 shrink-0 text-rose-500" />,
      `${plural(counts.failing, 'failing check')}`,
      'Inspect details or send them to the agent.',
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={!!busy || destination.kind === 'none'}
        title={sendTitle(destination, 'the failing checks and their logs')}
        onClick={onFix}
        data-fix
      >
        {fixing ? <RefreshCw className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
        {fixing ? (destination.kind === 'start' ? 'Starting agent…' : 'Sending…') : 'Fix'}
      </Button>,
    )
  }
  if (counts.pending > 0) return row(<LoaderCircle className="size-3.5 shrink-0 animate-spin text-amber-500" />, `${plural(counts.pending, 'check')} pending`, 'Refreshed while this tab stays open.')
  if (!checks.length) return null
  return row(<CircleCheck className="size-3.5 shrink-0 text-emerald-500" />, 'No blocking PR action', 'Checks and comments below show the current fetched context.')
}

function PrActions({ worktree, view, store, notify }: { worktree: string; view: ChecksView; store: StoreApi<ChecksState>; notify: Notify }): React.JSX.Element | null {
  const pr = view.pr!
  const busy = useStore(store, (s) => s.busy[worktree] ?? null)
  const methods = view.mergeMethods.length ? view.mergeMethods : (['squash'] as MergeMethod[])
  const [method, setMethod] = useState<MergeMethod>(methods[0])
  const [confirming, setConfirming] = useState(false)
  const chosen = methods.includes(method) ? method : methods[0]
  if (pr.state === 'merged' || pr.state === 'closed') return null
  const block = mergeBlock(pr, view.checks)
  const merging = busy?.kind === 'merge'
  const readying = busy?.kind === 'ready'

  const merge = () => {
    setConfirming(false)
    store
      .getState()
      .merge(worktree, chosen)
      .then(
        (r) => notify.ok(r.message),
        (e) => notify.fail(message(e)),
      )
  }
  const markReady = () =>
    store
      .getState()
      .ready(worktree)
      .then(
        () => notify.ok(`PR #${pr.number} is ready for review`),
        (e) => notify.fail(message(e)),
      )

  return (
    <div className="space-y-1.5" data-pr-actions>
      {confirming ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5" data-merge-confirm>
          <span className="min-w-0 flex-1 text-[11px] text-foreground">
            {METHOD_LABEL[chosen]} #{pr.number} into <span className="font-mono">{pr.base}</span>?
          </span>
          <Button type="button" size="xs" className="bg-green-600 text-white hover:bg-green-700" onClick={merge}>
            Merge
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {pr.state === 'draft' && (
            <Button type="button" variant="outline" size="xs" disabled={!!busy} onClick={markReady} data-ready>
              {readying ? <LoaderCircle className="size-3 animate-spin" /> : <GitPullRequest className="size-3" />}
              Ready for review
            </Button>
          )}
          <div className="flex min-w-0 items-center">
            <Button
              type="button"
              size="xs"
              className={cn('gap-1.5 bg-green-600 text-white hover:bg-green-700', methods.length > 1 && 'rounded-r-none')}
              disabled={!!block || !!busy}
              title={block ?? `${METHOD_LABEL[chosen]}: only if every check is still green on ${pr.headSha.slice(0, 7)}`}
              onClick={() => setConfirming(true)}
              data-merge
            >
              {merging ? <LoaderCircle className="size-3 animate-spin" /> : <GitMerge className="size-3" />}
              {METHOD_LABEL[chosen]}
            </Button>
            {methods.length > 1 && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="xs"
                    className="rounded-l-none border-l border-green-700/60 bg-green-600 px-1 text-white hover:bg-green-700"
                    disabled={!!busy}
                    aria-label="Merge method"
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {methods.map((m) => (
                    <DropdownMenuItem key={m} onSelect={() => setMethod(m)}>
                      <GitMerge className="size-4" />
                      {METHOD_LABEL[m]}
                      {m === chosen && <CheckIcon className="ml-auto size-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      {block && pr.state !== 'draft' && <div className="text-[10px] text-muted-foreground" data-merge-block>Merge waits: {block.charAt(0).toLowerCase() + block.slice(1)}.</div>}
    </div>
  )
}

function SendButton({ destination, busy, id, what, onSend }: { destination: Destination; busy: Busy; id: string; what: string; onSend(): void }): React.JSX.Element {
  const sending = busy?.kind === 'send' && busy.id === id
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      title={sendTitle(destination, what)}
      aria-label={`Send ${what} to the agent`}
      disabled={!!busy || destination.kind === 'none'}
      onClick={(e) => {
        e.stopPropagation()
        onSend()
      }}
      data-send={id}
    >
      {sending ? <LoaderCircle className="size-3 shrink-0 animate-spin" /> : <Sparkles className="size-3 shrink-0" />}
      Send
    </button>
  )
}

function CommentBody({ c, now, action }: { c: Comment; now: number; action?: React.ReactNode }): React.JSX.Element {
  const review = c.review ? REVIEW[c.review] : undefined
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="truncate font-semibold text-foreground">{c.author}</span>
        {review && <span className={cn('shrink-0', review.tone)}>{review.label.toLowerCase()}</span>}
        <span className="shrink-0 text-muted-foreground">{relativeTime(c.createdAt, now)}</span>
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
      <div className="mt-0.5 text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground">{c.body}</div>
    </div>
  )
}

function ThreadCard({ pr, thread, destination, busy, now, onSend }: { pr: ChecksPr; thread: Thread; destination: Destination; busy: Busy; now: number; onSend(id: string, text: string): void }): React.JSX.Element {
  const [open, setOpen] = useState(!thread.resolved)
  const where = `${thread.path}${thread.line ? `:${thread.line}` : ''}`
  return (
    <div className={cn('mx-3 my-2 overflow-hidden rounded-md border border-border/60 bg-background/40', thread.resolved && 'opacity-70')} data-thread={thread.id}>
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-2 py-1">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={where}>
            {where}
          </span>
        </button>
        {thread.outdated && <span className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground uppercase">Outdated</span>}
        {thread.resolved && <span className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground uppercase">Resolved</span>}
        <SendButton destination={destination} busy={busy} id={thread.id} what="this review comment" onSend={() => onSend(thread.id, threadPrompt(pr, thread))} />
      </div>
      {open && (
        <div className="space-y-2 px-2 py-2">
          {thread.comments[0]?.diffHunk && <pre className="scrollbar-sleek overflow-x-auto rounded bg-muted/40 px-2 py-1 font-mono text-[10px] leading-snug text-muted-foreground">{thread.comments[0].diffHunk}</pre>}
          {thread.comments.map((c, i) => (
            <div key={`${c.createdAt}-${i}`} className={cn(i > 0 && 'border-l-2 border-border/50 pl-2')}>
              <CommentBody c={c} now={now} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommentsSection({ view, destination, busy, now, onSend }: { view: ChecksView; destination: Destination; busy: Busy; now: number; onSend(id: string, text: string): void }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const pr = view.pr!
  const count = view.threads.length + view.comments.length
  return (
    <div data-comments>
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:bg-accent/40 hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')} />
        Comments
        <span className="font-medium tabular-nums">{count}</span>
      </button>
      {open && (
        <div className="pb-2">
          {view.threadsError && <div className="px-3 pt-2 text-[11px] break-words text-muted-foreground">Review threads could not be read: {view.threadsError}</div>}
          {!count && !view.threadsError && <div className="px-4 py-4 text-[11px] text-muted-foreground">No comments</div>}
          {view.threads.map((t) => (
            <ThreadCard key={t.id} pr={pr} thread={t} destination={destination} busy={busy} now={now} onSend={onSend} />
          ))}
          {view.comments.map((c, i) => {
            const id = `comment-${i}-${c.createdAt}`
            return (
              <div key={id} className="mx-3 my-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5" data-comment={id}>
                <CommentBody
                  c={c}
                  now={now}
                  action={<SendButton destination={destination} busy={busy} id={id} what="this comment" onSend={() => onSend(id, commentPrompt(pr, c))} />}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActiveContent({ worktree, view, props }: { worktree: string; view: ChecksView; props: ChecksPanelProps }): React.JSX.Element {
  const { store, destination, onOpenUrl, notify } = props
  const pr = view.pr!
  const tree = useStore(store, (s) => s.trees[worktree])
  const busy = useStore(store, (s) => s.busy[worktree] ?? null)
  const now = props.now ?? Date.now()
  const live = pr.state === 'open' || pr.state === 'draft'
  const review = pr.reviewDecision ? REVIEW[pr.reviewDecision] : undefined
  const StateIcon = pr.state === 'draft' ? GitPullRequestDraft : pr.state === 'merged' ? GitMerge : GitPullRequest

  const send = (id: string, prompt: () => Promise<string> | string, what: string) =>
    store
      .getState()
      .send(worktree, id, prompt, (text) => props.onSend(worktree, text))
      .then(
        (r) => notify.ok(r.started ? `Started an agent and sent it ${what}` : `Sent ${what} to ${r.title}`),
        (e) => notify.fail(message(e)),
      )

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto" data-checks-active>
      {tree?.error && (
        <div role="alert" className="border-b border-border/50 bg-destructive/10 px-3 py-2 text-xs break-words text-destructive">
          Could not refresh: {tree.error}
        </div>
      )}
      <div className="space-y-2.5 border-b border-border px-3 py-3" data-pr-header>
        <div className="flex items-center gap-2">
          <StateIcon className="size-4 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="rounded px-0.5 text-[12px] font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            title="Open on GitHub"
            onClick={() => onOpenUrl(pr.url, `PR #${pr.number}`)}
          >
            #{pr.number}
          </button>
          <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase', prStateColor(pr.state))}>{pr.state}</span>
          <div className="flex-1" />
          <RefreshButton loading={!!tree?.loading} onRefresh={() => void store.getState().load(worktree)} />
        </div>
        <div className="text-[12px] leading-snug break-words text-foreground">{pr.title}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className="min-w-0 truncate font-mono" title={`${pr.head} → ${pr.base}`}>
            {pr.head} → {pr.base}
          </span>
          {pr.author && <span>by {pr.author}</span>}
          <span className="tabular-nums">
            <span className="text-emerald-500">+{pr.additions}</span> <span className="text-rose-500">−{pr.deletions}</span>
          </span>
          {review && <span className={review.tone}>{review.label}</span>}
          {pr.updatedAt && <span>Updated {relativeTime(pr.updatedAt, now)}</span>}
        </div>
        <PrActions worktree={worktree} view={view} store={store} notify={notify} />
      </div>
      {live && (
        <TriageStrip
          pr={pr}
          checks={view.checks}
          busy={busy}
          destination={destination}
          onFix={() => void send('fix', () => store.getState().fixText(worktree), 'the failing checks')}
        />
      )}
      <ChecksList worktree={worktree} checks={view.checks} store={store} onOpenUrl={onOpenUrl} />
      <CommentsSection view={view} destination={destination} busy={busy} now={now} onSend={(id, text) => void send(id, () => text, id.startsWith('comment-') ? 'the comment' : 'the review comment')} />
    </div>
  )
}

/** Orca's Checks panel, read-only but for merge, ready and sending to the agent. */
export function ChecksPanel(props: ChecksPanelProps): React.JSX.Element {
  const { worktree, store } = props
  const tree = useStore(store, (s) => (worktree ? s.trees[worktree] : undefined))
  const refresh = () => worktree && void store.getState().load(worktree)
  const body = (() => {
    if (!worktree) return <EmptyState title="No workspace selected" detail="Select a workspace to view checks" />
    const view = tree?.view
    if (!view) {
      if (tree?.error)
        return (
          <EmptyState title="Checks unavailable" detail={tree.error}>
            <Button size="xs" variant="outline" onClick={refresh}>
              Retry
            </Button>
          </EmptyState>
        )
      return (
        <div className="flex items-center justify-center py-8" role="status" aria-label="Loading checks">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      )
    }
    if (!view.branch) return <EmptyState title="Checks unavailable" detail="HEAD is detached: check out a branch to see its pull request." />
    if (!view.pr)
      return (
        <EmptyState
          title="No pull request"
          detail={
            <>
              <span className="font-mono">{view.branch}</span> has no pull request on GitHub.
              {tree?.error ? ` (${tree.error})` : ''}
            </>
          }
        >
          <Button size="xs" onClick={() => props.onCreatePr(worktree)} data-create-pr>
            <GitPullRequest className="size-3" />
            Create pull request…
          </Button>
          <Button size="xs" variant="outline" disabled={tree?.loading} onClick={refresh}>
            {tree?.loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </EmptyState>
      )
    return <ActiveContent worktree={worktree} view={view} props={props} />
  })()
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-checks-panel data-ui>
      {body}
    </div>
  )
}

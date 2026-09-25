import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, CircleX, FileText, FolderOpen, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, LoaderCircle } from 'lucide-react'
import { cn } from '@/ui/cn'
import { AgentStateDot, type DotState } from '../dashboard/AgentStateDot'
import { childWord, needKind, permissionAsk, type ChildSession, type Pr } from '../mission/types'
import type { Row, Wave } from './model'
import { foldKey, select, setFold, useUi } from './store'
import { RowAnswer } from './answer'

/** The tab's left side (spec decision 5): one section per wave, the children's rows in it. */

export type ListActions = {
  openUrl(url: string, title: string): void
  openFile(path: string): void
  openWorkspace(child: ChildSession): void
}

/** Whether a section shows its rows, and a wave with work open its done rows: what the user
 *  flipped, else folded when finished (the section) and while work is open (the done rows). */
export function useFolds(parent: string, wave: Wave): { open: boolean; doneOpen: boolean } {
  const open = useUi((s) => s.folds[foldKey(parent, wave.key, 'wave')])
  const doneOpen = useUi((s) => s.folds[foldKey(parent, wave.key, 'done')])
  return { open: open ?? !wave.finished, doneOpen: doneOpen ?? false }
}

export function WaveList({ parent, waves, selected, answeringRight, actions, now }: { parent: string; waves: Wave[]; selected: string | null; answeringRight: string | null; actions: ListActions; now: number }) {
  if (!waves.length)
    return (
      <div className="flex flex-col gap-1 px-4 py-6 text-center text-xs text-muted-foreground" data-dispatch-empty>
        <span className="text-[13px] text-foreground">No dispatched children here</span>
        <span>A wave dispatched from a session in this workspace shows here, one section per wave.</span>
      </div>
    )
  return (
    <div className="flex flex-col">
      {waves.map((w) => (
        <Section key={w.key} parent={parent} wave={w} selected={selected} answeringRight={answeringRight} actions={actions} now={now} />
      ))}
    </div>
  )
}

function Section({ parent, wave, selected, answeringRight, actions, now }: { parent: string; wave: Wave; selected: string | null; answeringRight: string | null; actions: ListActions; now: number }) {
  const { open, doneOpen } = useFolds(parent, wave)
  // A wave with work open keeps its done rows under a fold; a finished one shows them all.
  const folding = !wave.finished && wave.done > 0
  const shown = folding && !doneOpen ? wave.rows.filter((r) => r.state !== 'done') : wave.rows
  const row = (r: Row) => <RowView key={r.key} parent={parent} row={r} selected={selected === r.child?.id} answeringRight={answeringRight === r.child?.id} actions={actions} now={now} />
  return (
    <section className="border-b border-border/60" data-wave={wave.feature} data-folded={open ? undefined : ''}>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setFold(foldKey(parent, wave.key, 'wave'), !open)}
          className="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-2 text-left hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {open ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          {/* The counts go under the wave's name when both do not fit. */}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className={cn('max-w-full truncate text-[12.5px] font-semibold', wave.issues ? 'text-muted-foreground' : 'text-foreground')}>{wave.feature}</span>
            <Counts wave={wave} />
          </span>
        </button>
        <WaveMeta wave={wave} actions={actions} />
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          {shown.map(row)}
          {folding && (
            <button
              type="button"
              aria-expanded={doneOpen}
              onClick={() => setFold(foldKey(parent, wave.key, 'done'), !doneOpen)}
              className="flex items-center gap-1 self-start rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              data-done-fold
            >
              {doneOpen ? <ChevronDown className="size-3" aria-hidden /> : <ChevronRight className="size-3" aria-hidden />}
              {doneOpen ? 'Hide' : 'Show'} {wave.done} done
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function Counts({ wave }: { wave: Wave }) {
  const parts: ReactNode[] = []
  if (wave.needsYou) parts.push(<span key="n" className="font-medium text-agent-question">{wave.needsYou} need{wave.needsYou === 1 ? 's' : ''} you</span>)
  if (wave.working) parts.push(<span key="w">{wave.working} working</span>)
  if (wave.done) parts.push(<span key="d">{wave.done} done</span>)
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums" data-counts>
      {parts.flatMap((p, i) => (i ? [<span key={`s${i}`} aria-hidden>·</span>, p] : [p]))}
    </span>
  )
}

/** The wave's PRs and their CI, whether it can land, and its contract. */
function WaveMeta({ wave, actions }: { wave: Wave; actions: ListActions }) {
  const prs = wave.rows.map((r) => r.pr).filter((p): p is Pr => !!p)
  const ci = prs.some((p) => p.ci === 'fail') ? 'fail' : prs.some((p) => p.ci === 'pending') ? 'pending' : prs.length && prs.every((p) => p.ci === 'pass') ? 'pass' : 'none'
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      {!wave.issues && prs.length > 0 && (
        <span className="inline-flex items-center gap-1 tabular-nums" title={`${prs.length} of ${wave.rows.length} pieces have a PR`}>
          <GitPullRequest className="size-3" aria-hidden />
          {prs.length}/{wave.rows.length}
          <CiIcon ci={ci} />
        </span>
      )}
      {wave.landable && (
        <span className="rounded-full border border-state-done/40 bg-state-done/10 px-1.5 py-px text-[10px] text-state-done" title="Every piece has a PR with green CI: the parent session can land it" data-landable>
          can land
        </span>
      )}
      {wave.contract && (
        <button type="button" className="rounded p-0.5 hover:bg-accent hover:text-foreground" title={`Open the contract: ${wave.contract.split('/').pop()}`} aria-label="Open the contract" onClick={() => actions.openFile(wave.contract)}>
          <FileText className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

function CiIcon({ ci, className }: { ci: Pr['ci']; className?: string }) {
  if (ci === 'pass') return <CircleCheck className={cn('size-3 text-emerald-500', className)} aria-label="CI passed" />
  if (ci === 'fail') return <CircleX className={cn('size-3 text-rose-500', className)} aria-label="CI failed" />
  if (ci === 'pending') return <LoaderCircle className={cn('size-3 text-amber-500', className)} aria-label="CI running" />
  return null
}

const PR_LOOK = {
  open: { icon: GitPullRequest, label: 'Open', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  draft: { icon: GitPullRequestDraft, label: 'Draft', className: 'border-border bg-muted/60 text-muted-foreground' },
  merged: { icon: GitMerge, label: 'Merged', className: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  closed: { icon: GitPullRequestClosed, label: 'Closed', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
} as const

export const prLook = (pr: Pr) => PR_LOOK[pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.draft ? 'draft' : 'open']

/** The PR as a pill that opens it, and its CI: which checks failed, by name. */
export function PrLine({ pr, onOpen }: { pr: Pr; onOpen(url: string, title: string): void }) {
  const look = prLook(pr)
  const Icon = look.icon
  const ci = pr.ci === 'fail' ? `failing: ${pr.failing?.join(', ') || 'checks'}` : pr.ci === 'pending' ? 'CI running' : pr.ci === 'pass' ? 'CI passed' : null
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen(pr.url, `PR #${pr.number}`)
        }}
        title={`${look.label} PR #${pr.number}: open it`}
        className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1 py-px text-[10px] leading-none tabular-nums hover:brightness-110', look.className)}
        data-pr={pr.number}
      >
        <Icon className="size-2.5" aria-hidden />#{pr.number}
      </button>
      {ci && (
        <span className={cn('flex min-w-0 items-center gap-1', pr.ci === 'fail' && 'text-rose-500')} title={ci} data-ci={pr.ci}>
          <CiIcon ci={pr.ci} className="shrink-0" />
          <span className="truncate">{ci}</span>
        </span>
      )}
    </span>
  )
}

/** A row's glyph and word: the child's own, or what became of the piece's PR once it is gone. */
export function rowLook(row: Row): { dot: DotState; word: string } {
  const c = row.child
  if (!c) return { dot: 'done', word: row.pr ? prLook(row.pr).label.toLowerCase() : 'done' }
  const word = childWord(c)
  if (row.state === 'needs-you') return { dot: 'needs-you', word: 'needs you' }
  if (row.state === 'working') return word === 'stalled' ? { dot: 'idle', word: 'stalled' } : { dot: 'working', word: 'working' }
  return word === 'stopped' ? { dot: 'idle', word: 'stopped' } : { dot: 'done', word: 'done' }
}

const WORD_TONE: Record<string, string> = { 'needs you': 'font-medium text-agent-question', stalled: 'text-status-warning', done: 'text-state-done', merged: 'text-violet-500' }

export function ago(iso: string | null | undefined, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  const m = Math.floor(Math.max(0, now - t) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/** One child: its state, piece, what it is doing, PR and CI. One that needs you carries its
 *  answer card, unless the detail beside is showing its conversation, whose foot has the same. */
function RowView({ parent, row, selected, answeringRight, actions, now }: { parent: string; row: Row; selected: boolean; answeringRight: boolean; actions: ListActions; now: number }) {
  const c = row.child
  const { dot, word } = rowLook(row)
  const needsYou = row.state === 'needs-you'
  const asked = c ? ((needKind(c) === 'permission' ? permissionAsk(c) : c.needs) ?? c.waiting_for ?? 'waiting for you') : null
  const what = needsYou ? (answeringRight ? asked : null) : c ? c.detail || c.intent : null
  const when = ago(c?.updated_at, now)
  return (
    <div
      data-row={row.key}
      data-state={row.state}
      data-selected={selected || undefined}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-2 py-1.5 transition-colors',
        needsYou ? 'border-agent-question/40 bg-agent-question/[0.06]' : 'border-border/60 bg-card',
        selected && 'ring-1 ring-ring/60',
        c && !selected && 'hover:border-border hover:bg-accent/40',
      )}
    >
      <button
        type="button"
        disabled={!c}
        onClick={() => c && select(parent, c.id)}
        className="flex w-full min-w-0 items-start gap-2 text-left focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
        title={c ? `Show ${row.piece}: its conversation, diff and checks` : undefined}
      >
        <AgentStateDot state={dot} className="mt-1" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">{row.piece}</span>
            <span className={cn('shrink-0 text-[11px] text-muted-foreground', WORD_TONE[word])}>{word}</span>
            {when && <span className="ml-auto shrink-0 pl-1 text-[10.5px] text-muted-foreground tabular-nums">{when}</span>}
          </span>
          {what && <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{what}</span>}
        </span>
      </button>
      {(row.pr || c) && (
        <div className="flex min-w-0 items-center gap-2 pl-[18px] text-[11px] text-muted-foreground">
          {row.pr ? <PrLine pr={row.pr} onOpen={actions.openUrl} /> : <span className="truncate font-mono text-[10.5px] text-foreground/60">{row.branch ?? c?.id}</span>}
          {c && (
            <button
              type="button"
              className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground"
              title="Open its workspace (its own worktree)"
              aria-label={`Open ${row.piece}'s workspace`}
              onClick={() => actions.openWorkspace(c)}
            >
              <FolderOpen className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
      {needsYou && c && !answeringRight && <RowAnswer child={c} />}
      {needsYou && c && answeringRight && <span className="pl-[18px] text-[11px] text-agent-question">Answer it in the conversation, on the right →</span>}
    </div>
  )
}

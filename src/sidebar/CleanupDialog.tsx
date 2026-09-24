// adapted from stablyai/orca components/workspace-cleanup/WorkspaceCleanupDialog.tsx,
// workspace-cleanup-dialog-header.tsx, workspace-cleanup-candidate-row.tsx,
// workspace-cleanup-confirm-remove.tsx, workspace-cleanup-status-pill.tsx and
// workspace-cleanup-dialog-notices.tsx (MIT, 122b8c25). Orca's facets, sort, sizes, ignore list
// and hosts are left out: mnemo lists only the stale worktrees, nothing selected.
import React from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCcw, Trash2, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui'
import { cn } from '@/ui/cn'
import {
  backToList,
  closeCleanup,
  confirmCleanup,
  removeSelected,
  scanCleanup,
  selectAll,
  selectedCandidates,
  toggleSelected,
  useArchive,
} from './archive'
import { staleLabel, type Candidate } from './cleanup-model'
import { activateWorktree } from './actions'

type Tone = 'neutral' | 'ready' | 'destructive'

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
        tone === 'neutral' && 'border-border bg-background text-muted-foreground',
        tone === 'ready' && 'border-status-success-border bg-status-success-background text-status-success',
        tone === 'destructive' && 'border-destructive/30 text-destructive',
      )}
    >
      {children}
    </span>
  )
}

function Pills({ c }: { c: Candidate }): React.JSX.Element {
  return (
    <>
      {c.stale.map((r) => (
        <StatusPill key={r} tone="ready">
          {staleLabel(r, c)}
        </StatusPill>
      ))}
      {c.kind === 'dispatched' && <StatusPill>dispatched</StatusPill>}
    </>
  )
}

/** Repo, and the branch when it is not the name. */
function Where({ c }: { c: Candidate }): React.JSX.Element {
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{c.repoName}</span>
      {c.branch && c.branch !== c.name && (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate font-mono">{c.branch}</span>
        </>
      )}
    </div>
  )
}

function RowAction({ label, tip, onClick, className, children }: { label: string; tip: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} className={className} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

const CandidateRow = React.memo(function CandidateRow({
  c,
  selected,
  failure,
  last,
  busy,
}: {
  c: Candidate
  selected: boolean
  failure: string | undefined
  last: boolean
  busy: boolean
}): React.JSX.Element {
  return (
    <div
      data-cleanup-row={c.path}
      className={cn(
        'group w-full border-b border-border/60 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-accent/40',
        selected && 'bg-accent/30',
        last && 'border-b-0',
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${c.name}`}
          disabled={busy}
          onClick={() => toggleSelected(c.path)}
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </button>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
            <Pills c={c} />
          </div>
          <Where c={c} />
          <div className="mt-0.5 min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">{c.path}</div>
          {failure && (
            <div role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{failure}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <RowAction
            label={`Open ${c.name}`}
            tip="Open workspace"
            onClick={() => {
              closeCleanup()
              activateWorktree(c.path)
            }}
          >
            <ExternalLink className="size-3.5" />
          </RowAction>
          {!busy && (
            <RowAction
              label={`Remove ${c.name}`}
              tip="Remove"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                selectAll(false)
                toggleSelected(c.path)
                confirmCleanup()
              }}
            >
              <Trash2 className="size-3.5" />
            </RowAction>
          )}
        </div>
      </div>
    </div>
  )
})

function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'destructive'; children: React.ReactNode }) {
  if (tone === 'destructive')
    return <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-destructive">{children}</div>
  return (
    <div className="flex items-start gap-2 border-b border-border bg-muted/25 px-5 py-2 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="m-3 flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{title}</span>
      {description ? <span className="text-xs">{description}</span> : null}
    </div>
  )
}

function ListStep(): React.JSX.Element {
  const s = useArchive((a) => a.cleanup)
  const selectedCount = s.candidates.filter((c) => s.selected.has(c.path)).length
  const busy = s.progress !== null
  const allSelected = s.candidates.length > 0 && selectedCount === s.candidates.length
  const initial = s.scanning && s.candidates.length === 0
  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <DialogTitle className="min-w-0 text-base">Clean up workspaces</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              Merged, or their PR merged or closed, with no changes and no agent at work. Removing one keeps its branch.
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
            <Button variant="destructive" size="sm" onClick={confirmCleanup} disabled={selectedCount === 0 || busy}>
              <Trash2 className="size-3.5" />
              Delete selected
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Refresh" onClick={() => void scanCleanup()} disabled={s.scanning || busy}>
                  <RefreshCcw className={cn('size-3.5', s.scanning && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                Refresh
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={closeCleanup}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </DialogHeader>

      {initial && (
        <div className="flex items-start gap-2 border-b border-border bg-muted/25 px-5 py-3">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <div className="text-xs font-medium text-foreground">Scanning workspaces</div>
        </div>
      )}
      {s.errors.map((e) => (
        <Notice key={e} tone="destructive">
          {e}
        </Notice>
      ))}
      {!s.scanning && s.kept && <Notice>Kept: {s.kept}.</Notice>}

      {s.candidates.length > 0 && (
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected ? true : selectedCount > 0 ? 'mixed' : false}
            aria-label="Select all"
            disabled={busy}
            onClick={() => selectAll(!allSelected)}
            className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {allSelected ? <Check className="size-3" strokeWidth={3} /> : selectedCount > 0 ? <span className="h-0.5 w-2 rounded bg-current" /> : null}
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {s.candidates.length} stale {s.candidates.length === 1 ? 'workspace' : 'workspaces'}
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div data-cleanup-list="">
          {!s.scanning && s.candidates.length === 0 && (
            <EmptyState title="Nothing to clean up." description="No workspace is merged and clean with no agent at work." />
          )}
          {s.candidates.map((c, i) => (
            <CandidateRow
              key={c.path}
              c={c}
              selected={s.selected.has(c.path)}
              failure={s.failures[c.path]}
              last={s.candidates.length > 1 && i === s.candidates.length - 1}
              busy={busy}
            />
          ))}
        </div>
      </ScrollArea>
    </>
  )
}

function ConfirmStep(): React.JSX.Element {
  const s = useArchive((a) => a.cleanup)
  const batch = selectedCandidates(s)
  const count = batch.length
  const progress = s.progress
  const deleting = progress !== null
  const value = progress ? Math.min(100, (100 * (progress.done + progress.failed)) / progress.total) : 0
  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base">{deleting ? `Deleting workspaces: ${count}` : `Delete workspaces: ${count}?`}</DialogTitle>
              <DialogDescription className="mt-1.5 text-xs leading-5">
                {deleting
                  ? 'You can close this and come back while deletion continues.'
                  : 'Their folders are deleted and their terminals closed. Their branches are kept.'}
              </DialogDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={backToList} disabled={deleting}>
            <X className="size-4" />
          </Button>
        </div>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        {progress && (
          <div className="border-b border-border bg-muted/25 px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="font-medium text-foreground" role="status">
                {progress.done}/{progress.total} deleted{progress.failed > 0 ? `, ${progress.failed} failed` : ''}
              </span>
            </div>
            <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
              <div className="h-full bg-primary transition-all" style={{ width: `${value}%` }} />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Selected for deletion: {count}</div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {batch.map((c, i) => (
            <div key={c.path} role="group" aria-label={c.name} className={cn('border-b border-border/60 px-5 py-2.5', i === count - 1 && 'border-b-0')}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                <Pills c={c} />
              </div>
              <Where c={c} />
              <div className="mt-0.5 min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">{c.path}</div>
            </div>
          ))}
        </ScrollArea>
      </div>
      <DialogFooter className="border-t border-border px-5 py-3">
        <Button variant="outline" onClick={deleting ? closeCleanup : backToList}>
          {deleting ? 'Close' : 'Cancel'}
        </Button>
        {!deleting && (
          <Button variant="destructive" onClick={() => void removeSelected()} disabled={count === 0}>
            <Trash2 className="size-4" />
            Delete {count}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

/** The cleanup view (`worktree.cleanup`): the stale worktrees of every repo, removed in one go. */
export function CleanupDialog(): React.JSX.Element | null {
  const open = useArchive((a) => a.cleanup.open)
  const step = useArchive((a) => a.cleanup.step)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeCleanup()}>
      <DialogContent
        showCloseButton={false}
        data-cleanup-dialog=""
        className="flex h-[min(720px,85vh)] w-[calc(100vw-3rem)] max-w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-3rem)] lg:w-[760px] lg:max-w-[760px]"
      >
        {step === 'list' ? <ListStep /> : <ConfirmStep />}
      </DialogContent>
    </Dialog>
  )
}

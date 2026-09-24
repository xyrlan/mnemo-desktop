// adapted from stablyai/orca components/right-sidebar/source-control/panel/panel.tsx,
// panel-ready.tsx, listing/section-header.tsx, listing/action-button.tsx,
// listing/uncommitted-sections.tsx, listing/uncommitted-entry-row.tsx, listing/diff-line-counts.tsx,
// listing/empty-state.tsx and commit/discard-dialog.tsx
import React, { useRef, useState } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { ChevronDown, File, GitBranch, GitCommitHorizontal, Minus, Plus, RotateCw, Trash, Undo2, X } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { ScmEntry, ScmFileStatus } from './client'
import {
  baseName,
  canDiscard,
  canStage,
  canUnstage,
  dirName,
  discardCopy,
  discardPaths,
  entryKey,
  sectionsOf,
  unstagePaths,
  type PendingDiscard,
  type Section,
} from './model'
import type { ScmState } from './store'

const STATUS: Record<ScmFileStatus, { letter: string; tone: string }> = {
  modified: { letter: 'M', tone: 'text-status-warning' },
  added: { letter: 'A', tone: 'text-status-success' },
  untracked: { letter: 'U', tone: 'text-status-success' },
  deleted: { letter: 'D', tone: 'text-destructive' },
  renamed: { letter: 'R', tone: 'text-primary' },
  copied: { letter: 'C', tone: 'text-primary' },
  conflicted: { letter: '!', tone: 'text-destructive' },
}

/** Orca's row actions: hidden until the row is hovered or holds focus, over the row's end. */
const ROW_ACTIONS =
  'absolute right-0 top-0 bottom-0 flex shrink-0 items-center gap-1.5 bg-accent pr-3 pl-2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'

function ActionButton({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
}): React.JSX.Element {
  // A disabled <button> loses pointer events and with them its tooltip: it stays live and does nothing.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn('text-muted-foreground hover:bg-background/70 hover:text-foreground', disabled && 'cursor-not-allowed opacity-50')}
          aria-label={title}
          aria-disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            if (!disabled) onClick(e)
          }}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

function LineCounts({ added, removed }: { added: number | null; removed: number | null }): React.JSX.Element | null {
  const a = typeof added === 'number' && added > 0
  const r = typeof removed === 'number' && removed > 0
  if (!a && !r) return null
  return (
    <span className="shrink-0 text-[10px] tabular-nums">
      {a && <span className="text-status-success">+{added}</span>}
      {a && r && <span> </span>}
      {r && <span className="text-destructive">-{removed}</span>}
    </span>
  )
}

function SectionHeader({ section, collapsed, onToggle, actions }: { section: Section; collapsed: boolean; onToggle(): void; actions: React.ReactNode }): React.JSX.Element {
  return (
    <div className="pt-3 pr-3 pb-1 pl-1">
      <div className="group/section flex items-center gap-x-1 rounded-md pr-1 hover:bg-accent hover:text-accent-foreground">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto min-h-6 min-w-0 flex-1 justify-start gap-x-1 py-0.5 text-left font-semibold tracking-wider text-foreground/70 uppercase group-hover/section:text-accent-foreground"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          <span className="min-w-0 truncate" title={section.title}>
            {section.title}
          </span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums">{section.entries.length}</span>
        </Button>
        <div className="ml-auto flex shrink-0 items-center justify-end">{actions}</div>
      </div>
    </div>
  )
}

type RowProps = {
  entry: ScmEntry
  current: boolean
  busy: boolean
  onOpen(entry: ScmEntry): void
  onStage(entry: ScmEntry): void
  onUnstage(entry: ScmEntry): void
  onDiscard(entry: ScmEntry): void
}

function EntryRow({ entry, current, busy, onOpen, onStage, onUnstage, onDiscard }: RowProps): React.JSX.Element {
  const s = STATUS[entry.status]
  const dir = dirName(entry.path)
  const discardTitle = entry.area === 'untracked' ? 'Delete untracked file' : entry.status === 'deleted' ? 'Restore file' : 'Discard changes'
  return (
    <div
      role="button"
      tabIndex={0}
      data-scm-path={entry.path}
      data-scm-area={entry.area}
      data-current={current || undefined}
      title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
      className={cn('group relative flex cursor-pointer items-center gap-1 py-1 pr-3 pl-4 transition-colors outline-none focus-visible:bg-accent/60', current ? 'bg-accent hover:bg-accent' : 'hover:bg-accent/40')}
      onClick={() => onOpen(entry)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        onOpen(entry)
      }}
    >
      <File className={cn('size-3.5 shrink-0', s.tone)} aria-hidden />
      <div className="min-w-0 flex-1 text-xs">
        <span className="block min-w-0 truncate">
          <span className={cn('text-foreground', entry.status === 'deleted' && 'line-through decoration-muted-foreground/60')}>{baseName(entry.path)}</span>
          {dir && <span className="ml-1.5 text-[11px] text-muted-foreground">{dir}</span>}
        </span>
      </div>
      <LineCounts added={entry.added} removed={entry.removed} />
      <span className={cn('w-4 shrink-0 text-center text-[10px] font-bold', s.tone)} aria-label={entry.status}>
        {s.letter}
      </span>
      <div className={ROW_ACTIONS}>
        {canDiscard(entry) && <ActionButton icon={entry.area === 'untracked' ? Trash : Undo2} title={discardTitle} disabled={busy} onClick={() => onDiscard(entry)} />}
        {canStage(entry) && <ActionButton icon={Plus} title={entry.area === 'conflicted' ? 'Mark resolved (stage)' : 'Stage'} disabled={busy} onClick={() => onStage(entry)} />}
        {canUnstage(entry) && <ActionButton icon={Minus} title="Unstage" disabled={busy} onClick={() => onUnstage(entry)} />}
      </div>
    </div>
  )
}

function DiscardDialog({ pending, onCancel, onConfirm }: { pending: PendingDiscard | null; onCancel(): void; onConfirm(): void }): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const copy = pending ? discardCopy(pending) : null
  const Icon = copy?.deletes ? Trash : Undo2
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-md"
        data-ui
        onOpenAutoFocus={(e) => {
          // Radix focuses Cancel first otherwise, and Enter would dismiss a destructive confirm.
          if (!confirmRef.current) return
          e.preventDefault()
          confirmRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{copy?.title ?? 'Discard changes?'}</DialogTitle>
          <DialogDescription className="text-xs">{copy?.description ?? 'This cannot be undone.'}</DialogDescription>
        </DialogHeader>
        {pending?.kind === 'area' ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            {pending.entries.length} {pending.entries.length === 1 ? 'file' : 'files'}
          </div>
        ) : pending?.kind === 'entry' ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="font-medium break-all text-foreground">{pending.entry.path}</div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="button" variant="destructive" data-action="confirm-discard" onClick={onConfirm}>
            <Icon className="size-4" />
            {copy?.confirm ?? 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">{children}</div>
}

export type SourceControlPanelProps = {
  /** The worktree on screen; null before one is chosen. */
  worktree: string | null
  store: StoreApi<ScmState>
  /** A file's row clicked: its diff. */
  onOpen(worktree: string, entry: ScmEntry): void
  /** The commit composer for the worktree. */
  onCommit(worktree: string): void
}

/** Orca's Source Control panel: the worktree's changes in sections — conflicts, staged,
 *  unstaged, untracked — each file staged, unstaged or discarded from its row or all at once
 *  from its section's header, and the commit composer's button at the foot. */
export function SourceControlPanel({ worktree, store, onOpen, onCommit }: SourceControlPanelProps): React.JSX.Element {
  const tree = useStore(store, (s) => (worktree ? s.trees[worktree] : undefined))
  const busy = useStore(store, (s) => (worktree ? (s.busy[worktree] ?? false) : false))
  const failed = useStore(store, (s) => (worktree ? (s.failed[worktree] ?? null) : null))
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [current, setCurrent] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDiscard | null>(null)

  if (!worktree) return <Centered>Select a workspace to view changes</Centered>
  const status = tree?.status ?? null
  if (!status) {
    if (tree?.error) return <Centered>{/not a git repository/i.test(tree.error) ? 'Source Control is only available for Git repositories' : `Could not read the changes: ${tree.error}`}</Centered>
    return <Centered>Reading the changes…</Centered>
  }

  const st = store.getState()
  const sections = sectionsOf(status.entries)
  const toggle = (area: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(area)) n.delete(area)
      else n.add(area)
      return n
    })
  const open = (e: ScmEntry) => {
    setCurrent(entryKey(e))
    onOpen(worktree, e)
  }
  const confirm = () => {
    const p = pending
    setPending(null)
    if (!p) return
    const { tracked, untracked } = discardPaths(p.kind === 'entry' ? [p.entry] : p.entries)
    void st.discard(worktree, tracked, untracked)
  }

  const sectionActions = (section: Section) => {
    const discardable = section.entries.filter(canDiscard)
    const stageable = section.entries.filter(canStage)
    const unstageable = section.entries.filter(canUnstage)
    const area = section.area
    return (
      <div className="flex items-center">
        {discardable.length > 0 && (area === 'unstaged' || area === 'untracked') && (
          <ActionButton
            icon={area === 'untracked' ? Trash : Undo2}
            title={area === 'untracked' ? 'Delete all untracked' : 'Discard all'}
            disabled={busy}
            onClick={() => setPending({ kind: 'area', area, entries: discardable })}
          />
        )}
        {stageable.length > 0 && area !== 'conflicted' && (
          <ActionButton icon={Plus} title="Stage all" disabled={busy} onClick={() => void st.stage(worktree, stageable.map((e) => e.path))} />
        )}
        {unstageable.length > 0 && <ActionButton icon={Minus} title="Unstage all" disabled={busy} onClick={() => void st.unstage(worktree, unstagePaths(unstageable))} />}
      </div>
    )
  }

  const staged = status.entries.filter((e) => e.area === 'staged').length
  const conflicts = status.entries.filter((e) => e.area === 'conflicted').length

  return (
    <div className="relative flex h-full flex-col overflow-hidden" data-source-control data-ui>
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-2 pl-3">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={status.root}>
          {status.branch ?? 'detached HEAD'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Refresh"
          title="Read the changes again"
          onClick={() => void st.load(worktree)}
        >
          <RotateCw className={cn('size-3.5', tree?.loading && 'animate-spin')} />
        </Button>
      </div>

      {(failed || (tree?.error && status) || status.truncated) && (
        <div role="status" className="shrink-0 border-b border-border px-3 py-1.5 text-[11px]">
          {failed && (
            <div className="flex items-start gap-1 text-destructive">
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{failed}</span>
              <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss" onClick={() => st.dismiss(worktree)}>
                <X className="size-3" />
              </button>
            </div>
          )}
          {tree?.error && <div className="text-destructive">Could not read the changes again: {tree.error}</div>}
          {status.truncated && <div className="text-muted-foreground">Only the first {status.entries.length} changes are listed.</div>}
        </div>
      )}

      <div className="scrollbar-sleek relative flex min-h-0 flex-1 flex-col overflow-auto pt-1" aria-busy={busy || undefined}>
        {sections.length === 0 ? (
          <div className="px-4 py-6">
            <div className="text-sm font-medium text-foreground">No changes</div>
            <div className="mt-1 text-xs text-muted-foreground">Everything in this worktree is committed.</div>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.area} data-scm-section={section.area}>
              <SectionHeader section={section} collapsed={collapsed.has(section.area)} onToggle={() => toggle(section.area)} actions={sectionActions(section)} />
              {!collapsed.has(section.area) &&
                section.entries.map((e) => (
                  <EntryRow
                    key={entryKey(e)}
                    entry={e}
                    current={current === entryKey(e)}
                    busy={busy}
                    onOpen={open}
                    onStage={(x) => void st.stage(worktree, [x.path])}
                    onUnstage={(x) => void st.unstage(worktree, unstagePaths([x]))}
                    onDiscard={(x) => setPending({ kind: 'entry', entry: x })}
                  />
                ))}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 pt-2 pb-2">
        <Button type="button" size="sm" className="w-full" data-action="commit" disabled={status.entries.length === 0} onClick={() => onCommit(worktree)}>
          <GitCommitHorizontal className="size-4" />
          Commit…
        </Button>
        {status.entries.length > 0 && (
          <div className="mt-1.5 truncate text-center text-[11px] text-muted-foreground">
            {conflicts > 0
              ? `${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} to resolve first`
              : staged > 0
                ? `${staged} staged · ${status.entries.length - staged} not staged`
                : `${status.entries.length} ${status.entries.length === 1 ? 'change' : 'changes'}, none staged`}
          </div>
        )}
      </div>

      <DiscardDialog pending={pending} onCancel={() => setPending(null)} onConfirm={confirm} />
    </div>
  )
}

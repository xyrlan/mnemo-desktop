// adapted from stablyai/orca src/renderer/src/components/worktree-jump-palette-surface.tsx
// (with worktree-jump-palette-worktree-row.tsx and worktree-jump-palette-primitives.tsx: the
// row, `HighlightedText`, `PaletteState`, `FooterKey`)

import { useDeferredValue, useMemo, useState } from 'react'
import type React from 'react'
import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command'
import { cn } from '@/ui/cn'
import type { AgentState, RepoNode } from '../fleet/types'
import { jumpEntries, type JumpEntry } from './model'
import { formatAge } from './age'
import type { MatchRange } from './search'

export type JumpPaletteProps = {
  open: boolean
  onOpenChange(open: boolean): void
  repos: RepoNode[]
  /** The worktree on screen, marked "Current". */
  activeWorktree: string | null
  onJump(path: string): void
  /** Epoch ms the ages are measured from; the time the palette opened. */
  now?: number
}

/** Mod+J: every worktree of the fleet, fuzzy-searched by name, branch and repo; Enter switches to
 *  the selected one. Radix unmounts the content once closed, after its fade. */
export function JumpPalette(props: JumpPaletteProps): React.JSX.Element {
  // Each opening starts afresh: an empty query, ages measured from now.
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(props.open)
  if (wasOpen !== props.open) {
    setWasOpen(props.open)
    if (props.open) setSession((n) => n + 1)
  }
  return <JumpPaletteSurface key={session} {...props} />
}

function JumpPaletteSurface({ open, onOpenChange, repos, activeWorktree, onJump, now }: JumpPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  // Ages hold still while the palette is open: measured from when it opened.
  const [openedAt] = useState(() => now ?? Date.now())
  const entries = useMemo(() => jumpEntries(repos, deferredQuery), [repos, deferredQuery])
  const [selected, setSelected] = useState('')
  // A new query selects its best match; a fleet update keeps the selection while it is listed.
  const [selectedFor, setSelectedFor] = useState(deferredQuery)
  if (selectedFor !== deferredQuery) {
    setSelectedFor(deferredQuery)
    setSelected(entries[0]?.path ?? '')
  }
  const value = entries.some((e) => e.path === selected) ? selected : (entries[0]?.path ?? '')
  const total = repos.reduce((n, r) => n + r.worktrees.length, 0)

  const jump = (path: string) => {
    onOpenChange(false)
    onJump(path)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Jump to worktree"
      description="Search every worktree by name, branch and project"
      overlayClassName="bg-black/55 backdrop-blur-[2px]"
      contentClassName="top-[min(10%,4rem)] w-[900px] max-w-[96vw] max-h-[min(90vh,calc(100vh-1.5rem))] overflow-hidden rounded-xl border border-border/70 bg-background/96 shadow-[0_26px_84px_rgba(0,0,0,0.32)] backdrop-blur-xl"
      commandProps={{ loop: true, value, onValueChange: setSelected, className: 'jump-palette-command bg-transparent' }}
    >
      <CommandInput
        placeholder="Jump to a worktree by name, branch or project..."
        value={query}
        onValueChange={setQuery}
        wrapperClassName="mx-3 mt-3 rounded-lg border border-border/55 bg-muted/28 px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        iconClassName="mr-2.5 h-4 w-4 text-muted-foreground/60"
        className="h-12 text-[14px] placeholder:text-muted-foreground/75"
      />
      <CommandList className="max-h-[min(600px,calc(100vh-14rem))] px-2.5 pb-2.5 pt-2">
        {entries.length === 0 ? (
          <CommandEmpty className="py-0">
            {total === 0 ? (
              <PaletteState title="No worktrees yet" subtitle="Add a project from the sidebar and its worktrees show here." />
            ) : (
              <PaletteState title="No matching worktrees" subtitle="Try a different name, branch or project." />
            )}
          </CommandEmpty>
        ) : (
          entries.map((entry) => (
            <WorktreeRow key={entry.path} entry={entry} current={entry.path === activeWorktree} now={openedAt} onSelect={() => jump(entry.path)} />
          ))
        )}
      </CommandList>
      <div className="flex items-center justify-end border-t border-border/60 px-3.5 py-2.5 text-[11px] text-muted-foreground/82">
        <div className="flex items-center gap-2">
          <FooterKey>Enter</FooterKey>
          <span>Open</span>
          <FooterKey>Esc</FooterKey>
          <span>Close</span>
          <FooterKey>↑↓</FooterKey>
          <span>Move</span>
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {deferredQuery.trim() ? `${entries.length} results found` : `${entries.length} items available`}
      </div>
    </CommandDialog>
  )
}

const DOT: Record<AgentState, string> = {
  'needs-you': 'bg-state-needs-you',
  working: 'bg-state-working animate-pulse',
  done: 'bg-state-done',
  idle: 'bg-state-idle',
}
const STATE_LABEL: Record<AgentState, string> = { 'needs-you': 'Needs you', working: 'Working', done: 'Done', idle: 'Idle' }

/** The worktree's most pressing agent state; a hollow ring with no agent. Unread adds a halo. */
function StatusDot({ state, unread }: { state: AgentState | null; unread: boolean }): React.JSX.Element {
  const label = state ? STATE_LABEL[state] : 'No agent'
  return (
    <span
      role="img"
      aria-label={unread ? `${label}, unread` : label}
      data-state={state ?? 'none'}
      className={cn(
        'size-2 rounded-full',
        state ? DOT[state] : 'border border-muted-foreground/45',
        unread && 'ring-2 ring-brand/35',
      )}
    />
  )
}

function WorktreeRow({ entry, current, now, onSelect }: { entry: JumpEntry; current: boolean; now: number; onSelect(): void }): React.JSX.Element {
  const age = formatAge(entry.lastActiveAt, now)
  return (
    <CommandItem
      value={entry.path}
      onSelect={onSelect}
      data-current={current ? 'true' : undefined}
      className={cn(
        'group mx-0.5 flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]',
        'data-[selected=true]:border-border data-[selected=true]:bg-accent data-[selected=true]:text-foreground',
      )}
    >
      <div className="flex h-5 w-4 shrink-0 items-center justify-center self-start">
        <StatusDot state={entry.state} unread={entry.unread} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-foreground">
                <HighlightedText text={entry.name} matchRanges={entry.ranges.name} />
              </span>
              {age ? (
                <span aria-label={`Last active ${age} ago`} className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground/70">
                  {age}
                </span>
              ) : null}
              {current && (
                <span className="shrink-0 self-center rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
                  Current
                </span>
              )}
              {entry.kind === 'main' && (
                <span className="shrink-0 self-center rounded border border-muted-foreground/30 bg-muted-foreground/5 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground">
                  primary
                </span>
              )}
              {entry.branch.trim().length > 0 ? (
                <>
                  <span className="shrink-0 text-muted-foreground/45">·</span>
                  <span className="truncate text-[12px] font-medium text-muted-foreground/92">
                    <HighlightedText text={entry.branch} matchRanges={entry.ranges.branch} />
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {entry.repo && (
              <span className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-semibold leading-none text-foreground">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-brand" />
                <span className="truncate">
                  <HighlightedText text={entry.repo} matchRanges={entry.ranges.repo} />
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </CommandItem>
  )
}

export function HighlightedText({
  text,
  matchRanges,
  highlightClassName = 'font-semibold text-foreground',
}: {
  text: string
  matchRanges?: readonly MatchRange[] | null
  highlightClassName?: string
}): React.JSX.Element {
  const ranges = (matchRanges ?? []).filter((range) => range.start < range.end && range.start < text.length)
  if (ranges.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    const start = Math.max(cursor, range.start)
    const end = Math.min(text.length, Math.max(start, range.end))
    if (start > cursor) parts.push(text.slice(cursor, start))
    if (end > start) {
      parts.push(
        <mark data-match="" className={cn('bg-transparent', highlightClassName)} key={`${start}-${end}`}>
          {text.slice(start, end)}
        </mark>,
      )
      cursor = end
    }
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function PaletteState({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function FooterKey({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-foreground/85">{children}</span>
}

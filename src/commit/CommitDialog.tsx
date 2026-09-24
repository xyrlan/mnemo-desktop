// adapted from stablyai/orca src/renderer/src/components/right-sidebar/source-control/commit/commit-area.tsx, commit-message-composer.tsx, commit-action-menu.tsx and commit-notices.tsx (MIT, 122b8c25)
import React, { useEffect, useId, useState } from 'react'
import { useStore } from 'zustand'
import { ArrowUp, Check, CircleAlert, CircleCheck, CloudUpload, ExternalLink, GitBranch, GitPullRequestArrow, Loader2, RefreshCw, Sparkles, Square, X } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Switch, Textarea, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { Change, CommitClient } from './client'
import { closeCommit, useCommitOpen } from './open'
import { getCommitMessageTextareaRows } from './rows'
import { createCommitStore, pickable, type CommitActions, type CommitState, type CommitStore, type Step } from './store'

export type CommitComposerProps = {
  client: CommitClient
  /** Opens a pull request's page (a browser pane). */
  onOpenUrl(url: string, title: string): void
  /** ⌘ on a Mac, Ctrl elsewhere. */
  modLabel?: string
}

/** The commit composer, open while `openCommit` names a worktree. */
export default function CommitComposer(props: CommitComposerProps): React.JSX.Element | null {
  const worktree = useCommitOpen((s) => s.worktree)
  const seq = useCommitOpen((s) => s.seq)
  if (!worktree) return null
  // Keyed by `seq`: every open starts over with a fresh read of the worktree.
  return <CommitDialog key={seq} worktree={worktree} {...props} />
}

function CommitDialog({ worktree, client, onOpenUrl, modLabel = '⌘' }: CommitComposerProps & { worktree: string }): React.JSX.Element {
  const [store] = useState(() => createCommitStore(client, worktree))
  const use = <T,>(sel: (s: CommitState & CommitActions) => T): T => useStore(store, sel)
  const status = use((s) => s.status)
  const loading = use((s) => s.loading)
  const committing = use((s) => s.committing)
  const pushing = use((s) => s.pushing)
  const creating = use((s) => s.creating)
  const prForm = use((s) => s.prForm)
  const pr = use((s) => s.pr)
  const committed = use((s) => s.committed)
  const pushed = use((s) => s.pushed)

  useEffect(() => {
    void store.getState().load()
    void store.getState().findPr()
  }, [store])

  const busy = committing || pushing || creating
  const folder = worktree.split(/[\\/]/).filter(Boolean).pop() ?? worktree

  return (
    <Dialog open onOpenChange={(open) => !open && closeCommit()}>
      <DialogContent data-ui className="max-h-[calc(100vh-4rem)] gap-3 overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <TooltipProvider delayDuration={400}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              Commit
              {status?.branch ? (
                <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                  <GitBranch className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{status.branch}</span>
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {folder}
              {status ? <SyncLine store={store} /> : null}
            </DialogDescription>
          </DialogHeader>

          <Notice store={store} step="status" title="Could not read the changes" />
          {status ? <Changes store={store} /> : loading ? <p className="py-6 text-center text-xs text-muted-foreground">Reading the changes…</p> : null}
          {status && status.changes.length > 0 ? <Composer store={store} modLabel={modLabel} /> : null}
          <Notice store={store} step="message" title="The message could not be written" />
          <Actions store={store} busy={busy} onOpenUrl={onOpenUrl} />
          <Notice store={store} step="commit" title="Commit failed" />
          <Notice store={store} step="push" title="Push failed" />
          {committed ? <Done>Committed <span className="font-mono">{committed.sha}</span> {committed.summary}</Done> : null}
          {pushed ? <Done>{pushed}</Done> : null}
          {prForm ? <PrForm store={store} /> : null}
          <Notice store={store} step="pr" title="Pull request" />
          {pr ? (
            <Done>
              <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => onOpenUrl(pr.url, `PR #${pr.number}`)}>
                PR #{pr.number} {pr.title} <span className="text-muted-foreground">({pr.state.toLowerCase()})</span>
                <ExternalLink className="size-3" aria-hidden />
              </button>
            </Done>
          ) : null}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}

function SyncLine({ store }: { store: CommitStore }): React.JSX.Element | null {
  const status = useStore(store, (s) => s.status)
  if (!status) return null
  const parts: string[] = []
  if (!status.remote) parts.push('no remote')
  else if (!status.branch) parts.push('detached HEAD')
  else if (!status.published) parts.push(`not on ${status.remote} yet`)
  if (status.ahead > 0) parts.push(`${status.ahead} to push`)
  if (status.behind > 0) parts.push(`${status.behind} to pull`)
  return parts.length ? <span> · {parts.join(' · ')}</span> : null
}

/** A status letter: what happened to the file, in git's words. */
function letterOf(c: Change): { letter: string; title: string; tone: string } {
  if (c.conflicted) return { letter: '!', title: 'Conflicted', tone: 'text-destructive' }
  const x = c.index !== '.' && c.index !== '?' ? c.index : c.worktree
  if (x === '?' || x === 'A') return { letter: 'A', title: c.index === '?' ? 'Untracked' : 'Added', tone: 'text-status-success' }
  if (x === 'D') return { letter: 'D', title: 'Deleted', tone: 'text-destructive' }
  if (x === 'R' || x === 'C') return { letter: x, title: `${x === 'R' ? 'Renamed' : 'Copied'} from ${c.origPath ?? '?'}`, tone: 'text-sky-500' }
  return { letter: x === 'T' ? 'T' : 'M', title: 'Modified', tone: 'text-status-warning' }
}

function Changes({ store }: { store: CommitStore }): React.JSX.Element {
  const status = useStore(store, (s) => s.status)!
  const picked = useStore(store, (s) => s.picked)
  const busy = useStore(store, (s) => s.committing || s.generating)
  const all = pickable(status)
  const allPicked = all.length > 0 && all.every((p) => picked.includes(p))
  const somePicked = picked.length > 0 && !allPicked

  if (status.changes.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        No changes to commit.
      </p>
    )
  }
  return (
    <section aria-label="Changes" className="rounded-md border border-border">
      <label className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          aria-label="Pick every change"
          checked={allPicked}
          ref={(el) => {
            if (el) el.indeterminate = somePicked
          }}
          disabled={busy || all.length === 0}
          onChange={(e) => store.getState().pickAll(e.target.checked)}
        />
        Changes
        <span className="ml-auto font-normal normal-case tracking-normal">
          {picked.length} of {status.changes.length} picked
        </span>
      </label>
      <ul className="scrollbar-sleek max-h-56 overflow-y-auto py-1">
        {status.changes.map((c) => {
          const { letter, title, tone } = letterOf(c)
          const slash = c.path.lastIndexOf('/')
          return (
            <li key={c.path}>
              <label className={cn('flex items-center gap-2 px-2.5 py-0.5 text-xs hover:bg-accent/40', c.conflicted && 'opacity-70')} title={c.conflicted ? 'Resolve the conflict before committing this file' : c.path}>
                <input type="checkbox" className="size-3.5 shrink-0 accent-primary" checked={picked.includes(c.path)} disabled={busy || c.conflicted} onChange={() => store.getState().toggle(c.path)} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-foreground">{c.path.slice(slash + 1)}</span>
                  {slash > 0 ? <span className="ml-1.5 text-muted-foreground">{c.path.slice(0, slash)}</span> : null}
                </span>
                <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', tone)} title={title} aria-label={title}>
                  {letter}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Composer({ store, modLabel }: { store: CommitStore; modLabel: string }): React.JSX.Element {
  const message = useStore(store, (s) => s.message)
  const generating = useStore(store, (s) => s.generating)
  const committing = useStore(store, (s) => s.committing)
  const nothingPicked = useStore(store, (s) => s.picked.length === 0)
  const hasMessage = message.trim().length > 0
  const generateDisabled = committing || nothingPicked || hasMessage
  const generateTip = committing ? 'Commit in progress…' : nothingPicked ? 'Pick at least one file to write a message for.' : hasMessage ? 'Clear the message to write a new one.' : 'Write the message with AI'
  return (
    <div className="relative">
      <textarea
        rows={getCommitMessageTextareaRows(message)}
        value={message}
        readOnly={generating}
        disabled={committing}
        onChange={(e) => store.getState().setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void store.getState().commit()
          }
        }}
        placeholder={generating ? 'Writing the message…' : `Message (${modLabel}↵ to commit)`}
        aria-label="Commit message"
        // Why: reserve right padding so text doesn't slide under the absolute-positioned Generate icon.
        className="scrollbar-sleek min-h-14 w-full resize-none appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-8 text-xs text-foreground shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30"
      />
      {generating ? (
        // While generating, the icon doubles as stop: hover or focus swaps the spinner for a square.
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => store.getState().stopGenerating()}
              aria-label="Stop writing the commit message"
              className="group absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/40"
            >
              <RefreshCw className="size-3.5 animate-spin group-hover:hidden group-focus-visible:hidden" />
              <Square className="hidden size-3.5 fill-current group-hover:block group-focus-visible:block" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            Writing the commit message. Click to stop.
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-disabled={generateDisabled}
              onClick={(event) => {
                if (generateDisabled) {
                  event.preventDefault()
                  return
                }
                void store.getState().generate()
              }}
              aria-label="Write the commit message with AI"
              className={cn(
                'absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                generateDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
              )}
            >
              <Sparkles className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {generateTip}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function Actions({ store, busy, onOpenUrl }: { store: CommitStore; busy: boolean; onOpenUrl(url: string, title: string): void }): React.JSX.Element | null {
  const status = useStore(store, (s) => s.status)
  const picked = useStore(store, (s) => s.picked.length)
  const hasMessage = useStore(store, (s) => s.message.trim().length > 0)
  const committing = useStore(store, (s) => s.committing)
  const pushing = useStore(store, (s) => s.pushing)
  const pr = useStore(store, (s) => s.pr)
  const prOpen = useStore(store, (s) => s.prForm !== null)
  if (!status) return null

  const canCommit = !busy && picked > 0 && hasMessage
  const commitWhy = picked === 0 ? 'Pick at least one file' : !hasMessage ? 'Write a message first' : undefined
  const pushWhy = !status.branch ? 'Check out a branch to push' : !status.remote ? 'This repo has no remote' : status.published && status.ahead === 0 ? 'Nothing to push' : undefined
  const canPush = !busy && !pushWhy
  const openPr = pr?.state === 'OPEN' ? pr : null
  const prWhy = !status.branch ? 'Check out a branch first' : !status.remote ? 'This repo has no remote' : status.branch === status.base ? `This is ${status.base}, the base branch` : undefined

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" size="sm" disabled={!canCommit} title={commitWhy} onClick={() => void store.getState().commit()}>
        {committing ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" aria-hidden />}
        Commit
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!canCommit || !status.remote || !status.branch} title={commitWhy} onClick={() => void store.getState().commit({ andPush: true })}>
        Commit &amp; Push
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!canPush} title={pushWhy} onClick={() => void store.getState().push()}>
        {pushing ? <Loader2 className="size-3.5 animate-spin" /> : status.published ? <ArrowUp className="size-3.5" aria-hidden /> : <CloudUpload className="size-3.5" aria-hidden />}
        {status.published ? `Push${status.ahead > 0 ? ` ${status.ahead}` : ''}` : 'Publish branch'}
      </Button>
      <span className="flex-1" />
      {openPr ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenUrl(openPr.url, `PR #${openPr.number}`)}>
          <GitPullRequestArrow className="size-3.5" aria-hidden />
          PR #{openPr.number}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={busy || prOpen || !!prWhy} title={prWhy} onClick={() => store.getState().openPr()}>
          <GitPullRequestArrow className="size-3.5" aria-hidden />
          Create PR…
        </Button>
      )}
    </div>
  )
}

function PrForm({ store }: { store: CommitStore }): React.JSX.Element {
  const form = useStore(store, (s) => s.prForm)!
  const drafting = useStore(store, (s) => s.drafting)
  const creating = useStore(store, (s) => s.creating)
  const status = useStore(store, (s) => s.status)
  const id = useId()
  const set = store.getState().setPr
  const willPush = !status?.published || (status?.ahead ?? 0) > 0
  return (
    <section aria-label="Pull request" className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <GitPullRequestArrow className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium">Pull request</span>
        <span className="flex-1" />
        <Button type="button" size="xs" variant="ghost" disabled={drafting || creating} onClick={() => void store.getState().draftPr()} aria-label="Write the title and description with AI">
          {drafting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {drafting ? 'Writing…' : 'Rewrite'}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-base`} className="w-10 shrink-0 text-xs text-muted-foreground">
          Into
        </label>
        <Input id={`${id}-base`} className="h-7 flex-1 font-mono text-xs" value={form.base} disabled={creating} onChange={(e) => set({ base: e.target.value })} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={form.draft} disabled={creating} onCheckedChange={(v) => set({ draft: v })} aria-label="Open as a draft" />
          Draft
        </label>
      </div>
      <Input aria-label="Pull request title" className="h-8 text-sm" placeholder={drafting ? 'Writing the title…' : 'Title'} value={form.title} disabled={creating} readOnly={drafting} onChange={(e) => set({ title: e.target.value })} />
      <Textarea aria-label="Pull request description" className="min-h-32 text-xs" rows={8} placeholder={drafting ? 'Writing the description…' : 'Description'} value={form.body} disabled={creating} readOnly={drafting} onChange={(e) => set({ body: e.target.value })} />
      <div className="flex items-center justify-end gap-1.5">
        {willPush ? <span className="mr-auto text-[11px] text-muted-foreground">Pushes the branch first.</span> : null}
        <Button type="button" size="sm" variant="ghost" disabled={creating} onClick={() => store.getState().closePr()}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={creating || drafting || !form.title.trim() || !form.base.trim()} onClick={() => void store.getState().createPr()}>
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <GitPullRequestArrow className="size-3.5" aria-hidden />}
          Create pull request
        </Button>
      </div>
    </section>
  )
}

/** A step's failure, as its program said it, until dismissed or the step runs again. */
function Notice({ store, step, title }: { store: CommitStore; step: Step; title: string }): React.JSX.Element | null {
  const text = useStore(store, (s) => s.errors[step])
  if (text === undefined) return null
  return (
    <div role="alert" data-step={step} className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">{title}</div>
        <pre className="scrollbar-sleek mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">{text}</pre>
      </div>
      <button type="button" aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground" onClick={() => store.getState().dismiss(step)}>
        <X className="size-3" />
      </button>
    </div>
  )
}

function Done({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border border-status-success-border bg-status-success-background px-2.5 py-1.5 text-xs">
      <CircleCheck className="size-3.5 shrink-0 text-status-success" aria-hidden />
      <div className="min-w-0 flex-1 truncate">{children}</div>
    </div>
  )
}

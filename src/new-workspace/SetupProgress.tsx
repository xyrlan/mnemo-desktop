import React, { useCallback, useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { CircleCheck, CircleX, LoaderCircle, X } from 'lucide-react'
import { cn } from '@/ui/cn'
import { shownRuns, type SetupRun, type SetupState } from './setup'

/** How long a finished setup's card stays before it goes by itself; a failed one stays. */
export const DONE_LINGER_MS = 5000

/** Cards, bottom right, for the setup commands of workspaces created here: running with its
 *  latest line, done (going away by itself) or failed with its last lines. A click on a card
 *  switches to its worktree. */
export default function SetupProgress({ store, onOpen }: { store: StoreApi<SetupState>; onOpen(path: string): void }): React.JSX.Element | null {
  const runs = useStore(store, (s) => s.runs)
  const shown = useMemo(() => shownRuns({ runs }), [runs])
  const dismiss = useCallback((id: string) => store.getState().dismiss(id), [store])
  if (shown.length === 0) return null
  return (
    // `data-ui`: new look even when the shell mounts this inside the old `.app` scope.
    <div data-ui className="pointer-events-none fixed right-4 bottom-10 z-toast flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {shown.map((run) => (
        <SetupCard key={run.id} run={run} onOpen={() => onOpen(run.path)} dismiss={dismiss} />
      ))}
    </div>
  )
}

function SetupCard({ run, onOpen, dismiss }: { run: SetupRun; onOpen(): void; dismiss(id: string): void }): React.JSX.Element {
  const { id, state } = run
  useEffect(() => {
    if (state !== 'done') return
    const t = setTimeout(() => dismiss(id), DONE_LINGER_MS)
    return () => clearTimeout(t)
  }, [id, state, dismiss])

  const last = run.lines.length ? run.lines[run.lines.length - 1] : null
  const tail = run.state === 'failed' ? run.lines.slice(-4) : last ? [last] : []
  const title = run.state === 'running' ? 'Setting up' : run.state === 'done' ? 'Set up' : 'Setup failed in'
  return (
    <div
      role="status"
      data-setup-state={run.state}
      className="group pointer-events-auto relative flex gap-2.5 rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <span className="mt-0.5 shrink-0">
        {run.state === 'running' ? (
          <LoaderCircle className="size-4 animate-spin text-state-working" aria-hidden="true" />
        ) : run.state === 'done' ? (
          <CircleCheck className="size-4 text-state-done" aria-hidden="true" />
        ) : (
          <CircleX className="size-4 text-destructive" aria-hidden="true" />
        )}
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <div className="truncate text-xs font-medium">
          {title} <span className="font-mono">{run.name || run.path}</span>
          {run.state === 'failed' && run.code !== null ? <span className="font-normal text-muted-foreground"> · exit {run.code}</span> : null}
        </div>
        {tail.map((line, i) => (
          <div key={i} className={cn('truncate font-mono text-[11px]', run.state === 'failed' ? 'text-destructive/85' : 'text-muted-foreground')}>
            {line || '\u00a0'}
          </div>
        ))}
      </button>
      {run.state !== 'running' ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(id)}
          className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

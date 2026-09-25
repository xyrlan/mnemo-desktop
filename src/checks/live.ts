// adapted from stablyai/orca components/right-sidebar/checks-panel/use-checks-panel-polling.tsx
import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { ChecksView } from './client'
import { pollDelay } from './model'
import type { ChecksState } from './store'

/** A read younger than this is shown as it is when the tab comes back, not read again. */
export const FRESH_MS = 5_000

export type LiveOpts = {
  delay?: (view: ChecksView | null) => number
  /** Whether the window is hidden: then nothing is read until it shows again. */
  hidden?: () => boolean
}

const documentHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** Keeps `worktree`'s PR current while the Checks tab shows it, and only then: the tab mounts
 *  this while it is the one open. Read on showing (unless just read), then again after
 *  `pollDelay` — sooner while a check runs — and when the window comes back. */
export function useLiveChecks(worktree: string | null, store: StoreApi<ChecksState>, opts: LiveOpts = {}): void {
  const { delay = pollDelay, hidden = documentHidden } = opts
  useEffect(() => {
    if (!worktree) return
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (gone) return
      clearTimeout(timer)
      timer = setTimeout(tick, delay(store.getState().trees[worktree]?.view ?? null))
    }
    const tick = () => {
      if (hidden()) return schedule()
      void store.getState().load(worktree).finally(schedule)
    }
    void store.getState().load(worktree, { maxAgeMs: FRESH_MS }).finally(schedule)
    const back = () => {
      if (!hidden()) void store.getState().load(worktree, { maxAgeMs: FRESH_MS }).finally(schedule)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      gone = true
      clearTimeout(timer)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [worktree, store, delay, hidden])
}

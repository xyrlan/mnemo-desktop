import type { ReviewProject } from '../../learned/client'
import type { WatchDeps } from '../../learned/launch'
import { watchForReview } from '../../learned/launch'
import type { DryRun } from '../../learned/types'
import { openIfMissing } from '../../setup/launch'
import { needsSetup, type ToolStatus } from '../../setup/tools'

export type FirstRunDeps = {
  /** The four `--version` probes, once the launch's first burst has passed. Null when they failed. */
  checkTools(): Promise<ToolStatus[] | null>
  /** The rows setup has now, and a way to hear it check again (an install, Check again). */
  toolRows(): ToolStatus[] | null
  subscribeTools(fn: () => void): () => void
  /** The review's launch check: its client and the repos it looks at (`watchForReview`). */
  review: Pick<WatchDeps, 'client' | 'cwds' | 'subscribe'>
  /** Puts the review on its consent screen for `target`; false when a review already on screen
   *  (a run, a checklist) keeps it. */
  ask(target: ReviewProject, dry: DryRun): boolean
  /** The review still waits on its consent, so its window is still worth opening. */
  stillAsking(): boolean
  /** The window open over the ship now, if any, and a way to hear it change. */
  openWindowId(): string | null
  subscribeWindow(fn: () => void): () => void
  /** Shows the Nexus and opens one of its windows over it. */
  open(id: 'setup' | 'learned'): void
}

/** Settles once `claude` and `mnemo` are both found: at launch, or when setup installs them. */
function setupDone(d: FirstRunDeps, stopped: () => boolean): { done: Promise<void>; stop(): void } {
  let stop = () => {}
  const done = new Promise<void>((resolve) => {
    const ok = () => {
      const rows = d.toolRows()
      return !!rows && !needsSetup(rows)
    }
    if (ok()) return resolve()
    stop = d.subscribeTools(() => {
      if (stopped() || !ok()) return
      stop()
      resolve()
    })
  })
  return { done, stop: () => stop() }
}

/** What the app asks at launch, in the Nexus's windows where the onboarding overlay asked it:
 *  - **Setup**, when `claude` or `mnemo` is missing (`openWindow('setup')`);
 *  - then, once both are found, **What mnemo learned** for the first known repo with history to
 *    read and no decision (`openWindow('learned')`).
 *  Neither jumps a window that is open (one the user opened in the first seconds, or Setup still
 *  being read): it opens when that one closes, if it still has something to show.
 *  Returns a stop: nothing opens after it. */
export function firstRun(d: FirstRunDeps): () => void {
  let stopped = false
  const isStopped = () => stopped
  const stops: (() => void)[] = []

  // A window opens only when none is open over the ship (one the user opened, or Setup still being
  // read), and only while it still has something to show. Each waits for its own turn.
  const openWhenFree = (id: 'setup' | 'learned', still: () => boolean) => {
    if (stopped || !still()) return
    if (d.openWindowId() === null) return d.open(id)
    const unsubscribe = d.subscribeWindow(() => {
      if (stopped || d.openWindowId() !== null) return
      unsubscribe()
      if (still()) d.open(id)
    })
    stops.push(unsubscribe)
  }
  const setupNeeded = () => {
    const rows = d.toolRows()
    return !!rows && needsSetup(rows)
  }

  void openIfMissing({
    restored: Promise.resolve(),
    check: () => d.checkTools(),
    open: () => openWhenFree('setup', setupNeeded),
  })

  // The review's consent: the store may hold only one, so it is asked for once.
  let reviewWaits = false
  const openLearned = () => {
    if (reviewWaits) return
    reviewWaits = true
    openWhenFree('learned', () => d.stillAsking())
  }

  const setup = setupDone(d, isStopped)
  stops.push(setup.stop)
  stops.push(
    watchForReview({
      ...d.review,
      ready: setup.done,
      show: (target, dry) => {
        if (!stopped && d.ask(target, dry)) openLearned()
      },
    }),
  )

  return () => {
    stopped = true
    stops.forEach((s) => s())
  }
}

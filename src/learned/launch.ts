import type { Store } from '../layout/store'
import { leaves } from '../layout/tree'
import type { LearnedClient, ReviewProject } from './client'
import { parseDryRun, type DryRun } from './types'

/** Shows the review pane: the one already open, wherever it is, or a new one in its own tab. */
export function showLearned(store: Store) {
  const s = store.getState()
  const open = s.tabs.flatMap((t) => leaves(t.root)).find((p) => s.panes[p]?.view === 'learned')
  if (open !== undefined) return s.goToPane(open)
  s.openView('learned', {}, 'tab', 'what mnemo learned')
}

export type WatchDeps = {
  client: Pick<LearnedClient, 'project' | 'decided' | 'step'>
  /** Settles once setup is done: the workspace is back and `claude` and `mnemo` are found. */
  ready: Promise<unknown>
  /** The repo directory the user has open now, if any. */
  cwd(): string | undefined
  /** Calls back on every change that may move `cwd`; returns the unsubscribe. */
  subscribe(fn: () => void): () => void
  show(target: ReviewProject, dry: DryRun): void
}

/** The launch check of the review: once setup is done, and again whenever the open repo
 *  changes, a project with no recorded decision whose dry run finds sessions gets the consent
 *  screen. Each project is looked at once per app run, each directory resolved once; nothing
 *  here reaches a model (the dry run only counts). Returns a stop. */
export function watchForReview(d: WatchDeps): () => void {
  let stopped = false
  let unsubscribe = () => {}
  const seenCwd = new Set<string>()
  const seenProject = new Set<string>()

  async function check(cwd: string | undefined) {
    if (stopped || !cwd || seenCwd.has(cwd)) return
    seenCwd.add(cwd)
    try {
      const target = await d.client.project(cwd)
      if (stopped || !target || seenProject.has(target.project)) return
      seenProject.add(target.project)
      if (await d.client.decided(target.project)) return
      const dry = parseDryRun((await d.client.step('dry-run', target)).stdout)
      if (!stopped && dry && dry.sessions > 0) d.show(target, dry)
    } catch {
      // A check that fails asks nothing: the vault screen still opens the review by hand.
    }
  }

  void d.ready.then(() => {
    if (stopped) return
    unsubscribe = d.subscribe(() => void check(d.cwd()))
    void check(d.cwd())
  })
  return () => {
    stopped = true
    unsubscribe()
  }
}

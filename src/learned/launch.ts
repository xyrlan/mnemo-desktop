import type { LearnedClient, ReviewProject } from './client'
import { parseDryRun, type DryRun } from './types'

export type WatchDeps = {
  client: Pick<LearnedClient, 'project' | 'decided' | 'step'>
  /** Settles once setup is done: `claude` and `mnemo` are found. */
  ready: Promise<unknown>
  /** The repo directories to look at, most likely first: every repo the Nexus knows. */
  cwds(): readonly string[]
  /** Calls back on every change that may add to `cwds`; returns the unsubscribe. */
  subscribe(fn: () => void): () => void
  show(target: ReviewProject, dry: DryRun): void
}

/** The launch check of the review: once setup is done, and again whenever the app learns of
 *  another repo, the repos are looked at in order, and the first project with no recorded decision
 *  whose dry run finds sessions gets the consent screen; nothing more is asked in that run. Each
 *  project is looked at once per app run, each directory resolved once; nothing here reaches a
 *  model (the dry run only counts). Returns a stop. */
export function watchForReview(d: WatchDeps): () => void {
  let stopped = false
  let asked = false
  let unsubscribe = () => {}
  const seenCwd = new Set<string>()
  const seenProject = new Set<string>()

  async function check(cwd: string) {
    if (seenCwd.has(cwd)) return
    seenCwd.add(cwd)
    try {
      const target = await d.client.project(cwd)
      if (stopped || !target || seenProject.has(target.project)) return
      seenProject.add(target.project)
      if (await d.client.decided(target.project)) return
      const dry = parseDryRun((await d.client.step('dry-run', target)).stdout)
      if (stopped || !dry || dry.sessions <= 0) return
      asked = true
      d.show(target, dry)
    } catch {
      // A check that fails asks nothing: SYSTEMS › What mnemo learned still opens the review by hand.
    }
  }

  // One look at a time, in order: a change that comes during one looks again once it ends.
  let looking = false
  let again = false
  async function look() {
    if (looking) return void (again = true)
    looking = true
    do {
      again = false
      for (const cwd of d.cwds()) {
        if (stopped || asked) break
        if (cwd) await check(cwd)
      }
    } while (again && !stopped && !asked)
    looking = false
  }

  void d.ready.then(() => {
    if (stopped) return
    unsubscribe = d.subscribe(() => void look())
    void look()
  })
  return () => {
    stopped = true
    unsubscribe()
  }
}

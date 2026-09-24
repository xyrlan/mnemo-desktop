import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { norm, within } from '../fleet/model'
import type { ScmClient } from './client'
import type { ScmState } from './store'

/** How often the changes are read when the tree cannot be watched. */
export const POLL_MS = 5_000

type LayoutView = { activeWorktree: string | null; activeTab: string; tabs: { id: string; focused: number | null }[]; panes: Record<number, { cwd?: string } | undefined> }
type ReposView = { worktrees: { path: string }[] }[]

/** The worktree on screen; before one is chosen, the one the focused pane's folder is in. */
export function currentWorktree(layout: LayoutView, repos: ReposView): string | null {
  if (layout.activeWorktree) return layout.activeWorktree
  const focused = layout.tabs.find((t) => t.id === layout.activeTab)?.focused
  const cwd = focused == null ? undefined : layout.panes[focused]?.cwd
  if (!cwd) return null
  const trees = repos.flatMap((r) => r.worktrees.map((w) => norm(w.path)))
  return trees.filter((t) => within(cwd, t)).sort((a, b) => b.length - a.length)[0] ?? cwd
}

/** Watch calls in the order made: a stop from one mount never lands after the next mount's start. */
export function serialWatch(client: Pick<ScmClient, 'watch'>): (worktree: string | null) => Promise<void> {
  let chain: Promise<unknown> = Promise.resolve()
  return (worktree) => {
    const next = chain.then(() => client.watch(worktree))
    chain = next.catch(() => {})
    return next
  }
}

export type LiveDeps = {
  client: Pick<ScmClient, 'onChanged'>
  watch: (worktree: string | null) => Promise<void>
  /** Calls `on` when the commit composer closes: a commit may have landed. */
  onCommitClosed(on: () => void): () => void
  pollMs?: number
}

/** Keeps `worktree`'s changes current while the panel shows them: read on showing, again when
 *  the watch says files changed, when the window comes back, and when the commit composer
 *  closes. A tree that cannot be watched is read every `pollMs` instead. */
export function useLiveChanges(worktree: string | null, store: StoreApi<ScmState>, deps: LiveDeps): void {
  const { client, watch, onCommitClosed, pollMs = POLL_MS } = deps
  useEffect(() => {
    if (!worktree) return
    let gone = false
    const load = () => void store.getState().load(worktree)
    load()
    let poll: ReturnType<typeof setInterval> | null = null
    watch(worktree).catch(() => {
      if (!gone) poll = setInterval(load, pollMs)
    })
    let unlisten: (() => void) | null = null
    client
      .onChanged(load)
      .then((u) => (gone ? u() : (unlisten = u)))
      .catch(() => {})
    window.addEventListener('focus', load)
    const unsubscribe = onCommitClosed(load)
    return () => {
      gone = true
      if (poll) clearInterval(poll)
      unlisten?.()
      window.removeEventListener('focus', load)
      unsubscribe()
    }
  }, [worktree, store, client, watch, onCommitClosed, pollMs])

  // Stops watching once the panel is gone (another tab, the sidebar closed).
  useEffect(() => () => void watch(null).catch(() => {}), [watch])
}

/** Clicks `path`'s row in the diff pane `pane` once the pane lists it, so the tab shows that
 *  file; gives up after `ms`. The diff tab takes no file to open on, and picks by that click. */
export function pickInDiff(pane: number, path: string, ms = 3_000, root: ParentNode = document): () => void {
  const until = Date.now() + ms
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = () => {
    const host = root.querySelector(`.pane[data-pane="${pane}"]`)
    const row = Array.from(host?.querySelectorAll<HTMLElement>('[data-file]') ?? []).find((el) => el.dataset.file === path)
    if (row) {
      if (row.getAttribute('aria-current') !== 'true') row.click()
      row.scrollIntoView?.({ block: 'nearest' })
    } else if (Date.now() < until) timer = setTimeout(attempt, 50)
  }
  attempt()
  return () => clearTimeout(timer)
}

/** Clicks the right sidebar's `label` tab once it is drawn, unless it is the one shown already;
 *  gives up after `ms`. The sidebar takes no tab to show from outside, and picks by that click. */
export function pickRightbarTab(label: string, ms = 1_000, root: ParentNode = document): () => void {
  const until = Date.now() + ms
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = () => {
    const tab = Array.from(root.querySelectorAll<HTMLElement>('[data-right-sidebar] [role="tab"]')).find((t) => t.getAttribute('aria-label') === label)
    if (tab) {
      if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    } else if (Date.now() < until) timer = setTimeout(attempt, 30)
  }
  attempt()
  return () => clearTimeout(timer)
}

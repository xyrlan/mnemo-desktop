/** A pane running a Claude session is named by Home's title for it, and the fleet names its
 *  agents the same way. A restored workspace, or a session started by hand, is newer than
 *  Home's snapshot: this reads it again — rarely — while some pane runs a session it does not
 *  know. `src/mission/Sidebar.tsx` did it while it was mounted; the shell no longer mounts it. */

/** At most this often. */
export const TITLE_RELOAD_MS = 60_000

export type TitleReloadSources = {
  /** Some open pane, in any worktree, runs a session Home has no title for. */
  unknown(): boolean
  /** Home is reading its snapshot already. */
  loading(): boolean
  load(): Promise<void>
  /** Calls `cb` whenever the panes or Home's snapshot may have changed. */
  onChange(cb: () => void): () => void
  now?(): number
}

/** Starts watching; returns the way to stop. */
export function startTitleReload(src: TitleReloadSources): () => void {
  const now = src.now ?? Date.now
  let last = -Infinity
  const check = () => {
    if (!src.unknown() || now() - last < TITLE_RELOAD_MS || src.loading()) return
    last = now()
    void src.load().catch(() => {})
  }
  const off = src.onChange(check)
  check()
  return off
}
